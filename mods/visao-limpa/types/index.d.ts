export type ConfigVisao = { resumo: boolean; linhas: boolean }

declare module 'claude-code' {
  interface PluginState {
    'visao-limpa': { config: ConfigVisao; abertos: string[]; ultimo: string[] | null }
  }
}
