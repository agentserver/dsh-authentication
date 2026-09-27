import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/dsh-host-webserver' {
  export interface WebRoute {
    readonly kind: 'exact' | 'prefix'
    readonly path: string
    readonly handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }
  export interface WebServer {
    register(route: WebRoute): () => void
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    readonly webServer: import('@deepseek-ai/dsh-host-webserver').WebServer
  }
}
