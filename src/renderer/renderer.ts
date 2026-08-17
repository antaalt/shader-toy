/**
 * Minimal shader-toy style WebGPU renderer.
 *
 * The editor text is used verbatim as a shader module: it must expose
 * `vs_main` (3-vertex fullscreen triangle) and `fs_main`, plus the `Uniforms`
 * block at `@group(0) @binding(0)`. Compiling verbatim keeps compilation
 * message line numbers aligned with the editor.
 */

export type CompileSeverity = 'error' | 'warning' | 'info'

export interface CompileMessage {
  /** 1-based; 0 when the driver could not attribute the message to a line. */
  line: number
  /** 1-based column. */
  column: number
  /** Length of the offending span in UTF-16 code units, 0 when unknown. */
  length: number
  message: string
  severity: CompileSeverity
}

export interface CompileResult {
  ok: boolean
  messages: CompileMessage[]
}

/** Byte size of the uniform block: 6 floats, padded to the required 16. */
const UNIFORM_BYTES = 32

export class ShaderRenderer {
  private readonly uniformData = new Float32Array(UNIFORM_BYTES / 4)
  private readonly uniformBuffer: GPUBuffer
  private readonly resizeObserver: ResizeObserver

  private pipeline: GPURenderPipeline | null = null
  private bindGroup: GPUBindGroup | null = null
  private frameHandle = 0
  private startTime = 0
  private frameCount = 0
  private mouse = { x: 0, y: 0 }
  private disposed = false

  private readonly canvas: HTMLCanvasElement
  private readonly device: GPUDevice
  private readonly context: GPUCanvasContext
  private readonly format: GPUTextureFormat

  private constructor(
    canvas: HTMLCanvasElement,
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
  ) {
    this.canvas = canvas
    this.device = device
    this.context = context
    this.format = format

    this.uniformBuffer = device.createBuffer({
      label: 'uniforms',
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.resize()

    canvas.addEventListener('pointermove', this.onPointerMove)
  }

  static async create(canvas: HTMLCanvasElement): Promise<ShaderRenderer> {
    if (!navigator.gpu) {
      throw new Error(
        'WebGPU is not available in this browser.\n' +
          'Try a recent Chrome/Edge, or enable the WebGPU flag.',
      )
    }

    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) throw new Error('No suitable GPU adapter was found.')

    const device = await adapter.requestDevice({ label: 'shader-toy' })
    const context = canvas.getContext('webgpu')
    if (!context) throw new Error('Could not acquire a "webgpu" canvas context.')

    const format = navigator.gpu.getPreferredCanvasFormat()
    context.configure({ device, format, alphaMode: 'opaque' })

    device.addEventListener('uncapturederror', (event) => {
      console.error('[webgpu]', (event as GPUUncapturedErrorEvent).error.message)
    })

    return new ShaderRenderer(canvas, device, context, format)
  }

  /**
   * Compiles `code` and, if it is valid, swaps it in as the live shader. On
   * failure the previously working shader keeps rendering and the messages
   * describe what went wrong.
   */
  async setShader(code: string): Promise<CompileResult> {
    const module = this.device.createShaderModule({ label: 'user-shader', code })
    const info = await module.getCompilationInfo()
    const messages = info.messages.map(toCompileMessage)

    if (messages.some((m) => m.severity === 'error')) {
      return { ok: false, messages }
    }

    try {
      const pipeline = await this.device.createRenderPipelineAsync({
        label: 'user-pipeline',
        layout: 'auto',
        vertex: { module, entryPoint: 'vs_main' },
        fragment: {
          module,
          entryPoint: 'fs_main',
          targets: [{ format: this.format }],
        },
        primitive: { topology: 'triangle-list' },
      })

      this.pipeline = pipeline
      this.bindGroup = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      })
      return { ok: true, messages }
    } catch (error) {
      messages.push({
        line: 0,
        column: 0,
        length: 0,
        message: error instanceof Error ? error.message : String(error),
        severity: 'error',
      })
      return { ok: false, messages }
    }
  }

  start(): void {
    if (this.frameHandle !== 0 || this.disposed) return
    this.startTime = performance.now()
    const loop = () => {
      if (this.disposed) return
      this.renderFrame()
      this.frameHandle = requestAnimationFrame(loop)
    }
    this.frameHandle = requestAnimationFrame(loop)
  }

  dispose(): void {
    this.disposed = true
    if (this.frameHandle !== 0) cancelAnimationFrame(this.frameHandle)
    this.frameHandle = 0
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.uniformBuffer.destroy()
    this.device.destroy()
  }

  private onPointerMove = (event: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect()
    const scale = this.canvas.width / Math.max(rect.width, 1)
    this.mouse.x = (event.clientX - rect.left) * scale
    // Flip: WGSL's @builtin(position).y grows downwards, matching the DOM, so
    // keep the mouse in the same space as frag coordinates.
    this.mouse.y = (event.clientY - rect.top) * scale
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1
    const max = this.device.limits.maxTextureDimension2D
    const width = clamp(Math.round(this.canvas.clientWidth * dpr), 1, max)
    const height = clamp(Math.round(this.canvas.clientHeight * dpr), 1, max)

    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
  }

  private renderFrame(): void {
    if (!this.pipeline || !this.bindGroup) return
    if (this.canvas.width === 0 || this.canvas.height === 0) return

    this.uniformData[0] = this.canvas.width
    this.uniformData[1] = this.canvas.height
    this.uniformData[2] = this.mouse.x
    this.uniformData[3] = this.mouse.y
    this.uniformData[4] = (performance.now() - this.startTime) / 1000
    this.uniformData[5] = this.frameCount++
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData)

    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, this.bindGroup)
    pass.draw(3)
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }
}

function toCompileMessage(message: GPUCompilationMessage): CompileMessage {
  return {
    line: message.lineNum,
    column: message.linePos,
    length: message.length,
    message: message.message,
    severity: message.type,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
