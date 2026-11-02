import { expect, test } from 'claude-code/testing'

import { escolher, migrarRegras } from '../hooks/decisao'
import type { Fonte, Pedido } from '../hooks/decisao'

const PRESETS = [
  { id: 'video', nome: 'Vídeo', modelo: 'opus', esforco: 'high', palavra: 'video' },
  { id: 'pesquisa', nome: 'Pesquisa/rápido', modelo: 'haiku', esforco: 'low', palavra: 'pesquisar' },
  { id: 'site', nome: 'Site/código', modelo: 'opus', esforco: 'medium', palavra: 'landing' },
  { id: 'estrategia', nome: 'Estratégia', modelo: 'opus', esforco: 'xhigh', palavra: 'plano' },
] as const

function fonte(ativo: string | null = null): Fonte {
  return {
    list: async () => PRESETS,
    ativo: async () => PRESETS.find(p => p.id === ativo) ?? null,
    classificar: async texto => {
      const p = PRESETS.find(x => texto.toLowerCase().includes(x.palavra))
      return p ? { preset: p, acertos: [p.palavra] } : null
    },
  }
}

const pedido = (tipo: string, description: string, extra: Partial<Pedido> = {}): Pedido => ({
  subagentType: tipo,
  description,
  prompt: '',
  fork: false,
  ...extra,
})

test('cada agente recebe o modelo da atividade da tarefa', async () => {
  expect(await escolher(pedido('general-purpose', 'Roteirizar o video 3'), {}, fonte())).toEqual({
    modelo: 'opus',
    esforco: 'high',
    motivo: 'atividade',
    atividade: 'Vídeo',
    pistas: ['video'],
  })
  expect((await escolher(pedido('general-purpose', 'pesquisar concorrentes'), {}, fonte())).modelo).toBe('haiku')
})

test('Explore e Plan têm atividade fixa, sem palavra-chave', async () => {
  const explore = await escolher(pedido('Explore', 'revisar a landing page'), {}, fonte())
  expect([explore.modelo, explore.atividade, explore.pistas]).toEqual(['haiku', 'Pesquisa/rápido', ['tipo Explore']])
  expect((await escolher(pedido('Plan', 'qualquer coisa'), {}, fonte())).esforco).toBe('xhigh')
})

test('prioridade: pedido > sua regra > atividade > /modo > padrão', async () => {
  expect(await escolher(pedido('general-purpose', 'video', { model: 'sonnet' }), { 'general-purpose': 'haiku' }, fonte())).toEqual({ motivo: 'pedido' })
  expect(await escolher(pedido('general-purpose', 'video'), { 'general-purpose': 'haiku' }, fonte())).toEqual({ modelo: 'haiku', motivo: 'regra' })
  expect(await escolher(pedido('general-purpose', 'sem pista'), {}, fonte('site'))).toEqual({
    modelo: 'opus',
    esforco: 'medium',
    motivo: 'modo',
    atividade: 'Site/código',
  })
  expect(await escolher(pedido('general-purpose', 'sem pista'), {}, fonte())).toEqual({ modelo: 'sonnet', motivo: 'padrao' })
  expect(await escolher(pedido('meu-agente', 'sem pista'), {}, fonte())).toEqual({ motivo: 'padrao' })
  expect(await escolher(pedido('general-purpose', 'video', { fork: true }), {}, fonte())).toEqual({ motivo: 'padrao' })
})

test('sem o painel-controle vale o comportamento antigo por tipo', async () => {
  expect(await escolher(pedido('general-purpose', 'video'), {}, null)).toEqual({ modelo: 'sonnet', motivo: 'padrao' })
  expect(await escolher(pedido('Explore', 'x'), {}, null)).toEqual({ modelo: 'haiku', motivo: 'padrao' })
})

test('migração das regras v0.1: igual ao padrão sai, diferente fica', () => {
  // v0.1 salvava o objeto inteiro ao editar só "Plan"
  expect(migrarRegras({ Explore: 'haiku', 'general-purpose': 'sonnet', Plan: 'sonnet' })).toEqual({ Plan: 'sonnet' })
  expect(migrarRegras({ 'meu-agente': 'opus' })).toEqual({ 'meu-agente': 'opus' })
})
