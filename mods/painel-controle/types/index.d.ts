export type PresetsModelo = 'opus' | 'sonnet' | 'haiku'

export type PresetsEsforco = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type PresetsItem = {
  id: string
  nome: string
  uso: string
  modelo: PresetsModelo
  esforco: PresetsEsforco
  palavras: readonly string[]
}

export type PresetsClassificacao = { preset: PresetsItem; acertos: string[] }

/** Uma tarefa a classificar: o título (a descrição curta) e, opcional, o detalhe (a instrução). */
export type PresetsTarefa = { titulo: string; detalhe?: string }

export type Presets = {
  /** Todos os presets, na ordem do painel. */
  list: () => Promise<PresetsItem[]>
  /** O preset ligado nesta conversa com /modo, ou null. */
  ativo: () => Promise<PresetsItem | null>
  /**
   * A atividade de uma tarefa pelas palavras-chave: o título manda, o detalhe só desempata; caminhos de
   * arquivo são ignorados. null se nenhuma ou se empatar entre (modelo, esforço) diferentes.
   */
  classificar: (tarefa: PresetsTarefa) => Promise<PresetsClassificacao | null>
}

declare module 'claude-code' {
  interface EngineInterface {
    presets: Presets
  }
  interface PluginState {
    'painel-controle': { ativo: string | null }
  }
}
