declare module 'tiged' {
  interface TigedOptions {
    disableCache?: boolean
    force?: boolean
    verbose?: boolean
    mode?: 'tar' | 'git'
  }

  interface TigedEmitter {
    on(event: 'info' | 'warn', callback: (info: { message?: string }) => void): void
    clone(dest: string): Promise<void>
  }

  export default function tiged(src: string, options?: TigedOptions): TigedEmitter
}
