export type ModeloAgente = 'haiku' | 'sonnet' | 'opus'

export type EsforcoAgente = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Por que o agente roda nesse modelo. */
export type Motivo = 'pedido' | 'regra' | 'atividade' | 'modo' | 'padrao' | 'retomado'

export type Agente = {
  id: string
  nome: string
  tipo: string
  modelo: string
  status: 'rodando' | 'concluido' | 'erro' | 'desconhecido'
  tokens: number
  inicio: number
  fim: number | null
  // Campos da v0.2: opcionais para que registros antigos sobrevivam ao reload.
  motivo?: Motivo
  atividade?: string
  esforco?: EsforcoAgente
  /** Palavras da tarefa (ou o tipo) que decidiram a atividade; vazio/ausente = nenhuma pista. */
  pistas?: string[]
  /** Quantas execuções deste agente já terminaram (para a retomada saber se a dela terminou). */
  fins?: number
}

export type Regras = Record<string, ModeloAgente>

export type Totais = { principal: number; agentes: number }

declare module 'claude-code' {
  interface PluginState {
    'time-agentes': {
      agentes: Shaped<Agente[]>
      principal: number
      totais: Totais | null
      regras: Regras
      ocultos: string[]
      faixaAte: number
    }
  }
}
