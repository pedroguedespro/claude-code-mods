import type { EsforcoAgente, ModeloAgente, Motivo, Regras } from '../types'

export type Decisao = { modelo?: ModeloAgente; esforco?: EsforcoAgente; motivo: Motivo; atividade?: string; pistas?: string[] }

type Preset = { id: string; nome: string; modelo: ModeloAgente; esforco: EsforcoAgente }

// O que o painel-controle oferece em $.presets (null quando ele não está instalado).
export type Fonte = {
  list: () => Promise<readonly Preset[]>
  ativo: () => Promise<Preset | null>
  classificar: (titulo: string, detalhe?: string) => Promise<{ preset: Preset; acertos?: string[] } | null>
}

export type Pedido = { model?: string; fork: boolean; subagentType: string; description: string; prompt: string }

// Modelo por tipo quando nada mais decide (e sem o painel-controle).
export const REGRAS_PADRAO: Regras = { Explore: 'haiku', 'general-purpose': 'sonnet', Plan: 'opus' }
// Tipos cuja atividade já se sabe pelo próprio tipo: não passam por palavra-chave.
export const TIPO_ATIVIDADE: Record<string, string> = { Explore: 'pesquisa', Plan: 'estrategia' }

// Prioridade: pedido explícito > sua regra > atividade da tarefa > /modo da conversa > padrão do tipo.
export async function escolher(e: Pedido, minhas: Regras, fonte: Fonte | null): Promise<Decisao> {
  if (e.model !== undefined) return { motivo: 'pedido' }
  if (e.fork) return { motivo: 'padrao' }

  const regra = minhas[e.subagentType]
  if (regra) return { modelo: regra, motivo: 'regra' }

  if (fonte) {
    const fixa = TIPO_ATIVIDADE[e.subagentType]
    const doTipo = fixa ? (await fonte.list()).find(p => p.id === fixa) : undefined
    if (doTipo) {
      return { modelo: doTipo.modelo, esforco: doTipo.esforco, motivo: 'atividade', atividade: doTipo.nome, pistas: [`tipo ${e.subagentType}`] }
    }
    const achada = await fonte.classificar(e.description, e.prompt.slice(0, 500))
    if (achada) {
      const { preset } = achada
      return { modelo: preset.modelo, esforco: preset.esforco, motivo: 'atividade', atividade: preset.nome, pistas: achada.acertos ?? [] }
    }
    const ligado = await fonte.ativo()
    if (ligado) return { modelo: ligado.modelo, esforco: ligado.esforco, motivo: 'modo', atividade: ligado.nome }
  }

  const padrao = REGRAS_PADRAO[e.subagentType]
  return padrao ? { modelo: padrao, motivo: 'padrao' } : { motivo: 'padrao' }
}

// Regras salvas pela v0.1: ela gravava os padrões junto, então igual ao padrão = não é escolha do usuário.
export function migrarRegras(antigas: Regras): Regras {
  return Object.fromEntries(Object.entries(antigas).filter(([tipo, m]) => REGRAS_PADRAO[tipo] !== m)) as Regras
}
