export type Limite = { kind: string; percentUsed: number; resetsAt?: string }

export type Leitura = {
  limites: Limite[]
  gastoSessaoUsd: number
  gastoUltimoPromptUsd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'barra-creditos': { leitura: Leitura | null; oculta: boolean }
  }
}
