import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'time-agentes',
  component: 'Pane',
  requestId: 'time-agentes',
  props: { title: 'Time de agentes', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

const BAND = {
  plugin: 'time-agentes',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 } },
} as const

type Opcoes = { esperarRetomada?: Promise<void>; temLugar?: boolean; lista?: { id: string; status: string }[]; estado?: Record<string, unknown>; store?: Record<string, unknown> }

// O "engine" de mentira, por baixo do mod. Cada pedido de um turno gasta 1000 tokens.
function engine(on: any, o: Opcoes = {}) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, o.store ?? {})
  const modelos: unknown[] = []
  const esforcos: unknown[] = []
  on('command.register', () => ({ value: { command: 'agentes' } }))
  on('ui.open', () => ({ value: { isPlaced: o.temLugar ?? true } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('agent.list', () => ({ value: (o.lista ?? []).map(a => ({ description: '', type: 'x', ...a })) }))
  if (o.estado) {
    // Estado que sobreviveu ao reload: guarda o que é escrito, com versão, como o engine.
    const guardado = new Map<string, { value: unknown; version: number }>(
      Object.entries(o.estado).map(([k, v]) => [k, { value: v, version: 1 }]),
    )
    on('state.get', (_: unknown, e: { key: string }) => ({ value: guardado.get(e.key) ?? { value: undefined, version: 0 } }))
    on('state.set', (_: unknown, e: { key: string; value: unknown; ifVersion?: number }) => {
      const atual = guardado.get(e.key)?.version ?? 0
      if (e.ifVersion !== undefined && e.ifVersion !== atual) return { value: { isSet: false, version: atual } }
      guardado.set(e.key, { value: e.value, version: atual + 1 })
      return { value: { isSet: true, version: atual + 1 } }
    })
  }
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 's' }))
  on('agent.spawn', async (_: unknown, e: { model?: string; resume?: { agentId: string } }) => {
    modelos.push(e.model)
    if (e.resume) {
      await o.esperarRetomada
      return { model: 'claude-sonnet-5-5', agentId: e.resume.agentId }
    }
    const nome = e.model === 'haiku' ? 'claude-haiku-5-5' : e.model === 'opus' ? 'claude-opus-5-5' : 'claude-sonnet-5-5'
    return { model: nome, agentId: `ag${modelos.length}` }
  })
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_: unknown, e: { turnId: string; index: number; effort?: unknown }) {
    esforcos.push(e.effort)
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { model: 'x', input_tokens: 700, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }
  })
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>de baixo</Text>
  })
  return { clock, modelos, esforcos }
}

const iniciar = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const spawn = (tipo: string, descricao: string, extra: object = {}) =>
  ({ tool_use_id: 't', prompt: 'p', description: descricao, subagentType: tipo, provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-sonnet-5-5', background: false, fork: false, ...extra }) as never
const passo = async ($: any, agentId?: string, effort = 'medium') => {
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'x', effort, messageCount: 1, ...(agentId ? { agentId } : {}) })) {
  }
}
const fim = ($: any, agentId: string) => $.turn.complete({ turnId: 't', agentId, answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' })

test('faixa mostra o time enquanto roda, some 60 s depois do último terminar, e não apaga a faixa de baixo', async ($, on) => {
  const { clock } = engine(on)
  await iniciar($)
  await $.agent.spawn(spawn('general-purpose', 'Revisar textos'))
  await passo($, 'ag1')
  await passo($)

  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect((await ui.find({ type: 'Text', text: /Time de agentes · 1 rodando · 2k tokens/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /Revisar textos/ }))?.text).toMatch(/Sonnet · padrão .*1k 50%/)
  expect((await ui.find({ type: 'Text', text: /de baixo/ }))?.text).toBe('de baixo')
  await ui.unmount()

  await fim($, 'ag1')
  await clock.advance(30_000)
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect((await ui.find({ type: 'Text', text: /✓/ }))?.text).toBeTruthy()
  await ui.unmount()

  await clock.advance(31_000)
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect(await ui.find({ type: 'Text', text: /Time de agentes/ })).toBeFalsy()
  expect((await ui.find({ type: 'Text', text: /de baixo/ }))?.text).toBe('de baixo')
  await ui.unmount()
})

test('faixa sai da frente de uma pesquisa (survey)', async ($, on) => {
  engine(on)
  await iniciar($)
  await $.agent.spawn(spawn('general-purpose', 'X'))
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'desktop' } as never)
  expect(await ui.find({ type: 'Text', text: /Time de agentes/ })).toBeFalsy()
  await ui.unmount()
})

test('eventos do agente que chegam antes do spawn resolver não se perdem', async ($, on) => {
  engine(on)
  await iniciar($)
  await $.turn.start({ text: 'p', turnId: 't', agentId: 'ag1' } as never)
  await passo($, 'ag1')
  await fim($, 'ag1')
  await $.agent.spawn(spawn('general-purpose', 'Agente rápido'))

  const r = (await $.command.run({ command: 'agentes', args: '' } as never)) as { text: string }
  expect(r.text).toBe('Painel do time de agentes aberto.')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect((await ui.find({ type: 'Text', text: /Agente rápido/ }))?.text).toMatch(/^✓ Agente rápido · general-purpose · Sonnet/)
  expect((await ui.find({ type: 'Text', text: /1k \(100%\)/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('retomada não duplica, mantém os tokens e volta a aparecer depois de "Limpar"', async ($, on) => {
  engine(on)
  await iniciar($)
  await $.agent.spawn(spawn('general-purpose', 'Longo'))
  await passo($, 'ag1')
  await fim($, 'ag1')

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  await ui.press({ key: 'limpar' })
  expect(await ui.find({ type: 'Text', text: /Longo/ })).toBeFalsy()
  await ui.unmount()

  await $.agent.spawn(spawn('general-purpose', 'Longo', { resume: { agentId: 'ag1' } }))
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect((await ui.find({ type: 'Text', text: /^1 agentes · 1 rodando/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /Longo/ }))?.text).toMatch(/^◐/)
  expect((await ui.find({ type: 'Text', text: /1k \(100%\)/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('"Limpar" não esconde quem ainda roda nem muda as %', async ($, on) => {
  engine(on)
  await iniciar($)
  await $.agent.spawn(spawn('general-purpose', 'Pronto'))
  await $.agent.spawn(spawn('general-purpose', 'Rodando'))
  await passo($, 'ag1')
  await passo($, 'ag2')
  await fim($, 'ag1')

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  await ui.press({ key: 'limpar' })
  await ui.unmount()
  await fim($, 'ag2')
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect(await ui.find({ type: 'Text', text: /Pronto/ })).toBeFalsy()
  expect((await ui.find({ type: 'Text', text: /Rodando/ }))?.text).toMatch(/^✓/)
  expect((await ui.find({ type: 'Text', text: /1k \(50%\)/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('acima de 30 agentes nenhum que está rodando é descartado', async ($, on) => {
  engine(on)
  await iniciar($)
  for (let i = 0; i < 31; i++) await $.agent.spawn(spawn('general-purpose', `A${i}`))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect((await ui.find({ type: 'Text', text: /^31 agentes · 31 rodando/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('reload da v0.1: migra regras e totais, normaliza registros e confere quem estava rodando', async ($, on) => {
  const antigo = { id: 'ag9', nome: 'Antigo', tipo: 'general-purpose', modelo: 'Sonnet', status: 'rodando', tokens: 3000, inicio: 1, fim: null }
  engine(on, {
    store: { regras: { Explore: 'haiku', 'general-purpose': 'sonnet', Plan: 'sonnet' } },
    estado: { principal: 5000, agentes: { shape: 'agentes-1', value: [antigo] } },
    lista: [],
  })
  await iniciar($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect((await ui.find({ type: 'Text', text: /tokens no total/ }))?.text).toMatch(/8k tokens no total/)
  expect((await ui.find({ type: 'Text', text: /Antigo/ }))?.text).toMatch(/^\? Antigo .* padrão/)
  expect((await ui.find({ type: 'Button', text: /^Plan/ }))?.text).toMatch(/sempre Sonnet/)
  expect((await ui.find({ type: 'Button', text: /^Explore/ }))?.text).toMatch(/automático/)
  await ui.unmount()
})

test('o esforço guardado no registro vale nos pedidos do agente, mesmo depois de reload', async ($, on) => {
  const { esforcos } = engine(on, {
    estado: { agentes: { shape: 'agentes-1', value: [{ id: 'ag9', nome: 'V', tipo: 'general-purpose', modelo: 'Opus', status: 'rodando', tokens: 0, inicio: 1, fim: null, motivo: 'atividade', atividade: 'Vídeo', esforco: 'high' }] } },
    lista: [{ id: 'ag9', status: 'running' }],
  })
  await iniciar($)
  await passo($, 'ag9', 'medium')
  await passo($, undefined, 'medium')
  expect(esforcos).toEqual(['high', 'medium'])
})

test('/clear zera o time', async ($, on) => {
  engine(on)
  await iniciar($)
  await $.agent.spawn(spawn('general-purpose', 'X'))
  await passo($, 'ag1')
  await $.session.end({ reason: 'clear' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect((await ui.find({ type: 'Text', text: /^0 agentes · 0 rodando · 0 tokens/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('sem lugar para o painel, /agentes mostra o resumo com barras no chat', async ($, on) => {
  engine(on, { temLugar: false })
  await iniciar($)
  await $.agent.spawn(spawn('Explore', 'Buscar arquivos'))
  await passo($, 'ag1')
  const r = (await $.command.run({ command: 'agentes', args: '' } as never)) as { text: string }
  expect(r.text).toMatch(/não tem onde mostrar o painel/)
  expect(r.text).toMatch(/◐ Buscar arquivos · Haiku · padrão \(sem pista na tarefa\)\n {3}█{12} 1k \(100%\)/)
})

test('/agentes <tipo> fixa ou devolve ao automático', async ($, on) => {
  const { modelos } = engine(on)
  await iniciar($)
  const r = (await $.command.run({ command: 'agentes', args: 'general-purpose opus' } as never)) as { text: string }
  expect(r.text).toBe('general-purpose: sempre no Opus (vence a atividade).')
  await $.agent.spawn(spawn('general-purpose', 'X'))
  await $.command.run({ command: 'agentes', args: 'general-purpose auto' } as never)
  await $.agent.spawn(spawn('general-purpose', 'Y'))
  expect(modelos).toEqual(['opus', 'sonnet'])
})

test('Codex #1: retomada que termina antes de o spawn resolver não volta a "rodando"', async ($, on) => {
  let liberar = () => {}
  const esperarRetomada = new Promise<void>(r => (liberar = r))
  const { clock } = engine(on, { esperarRetomada })
  await iniciar($)
  await $.agent.spawn(spawn('general-purpose', 'Curto'))
  await fim($, 'ag1')
  await clock.advance(1000)

  const retomada = $.agent.spawn(spawn('general-purpose', 'Curto', { resume: { agentId: 'ag1' } }))
  await clock.settle()
  // mesmo milissegundo do início da retomada: o relógio não anda
  await fim($, 'ag1')
  liberar()
  await retomada

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect((await ui.find({ type: 'Text', text: /Curto/ }))?.text).toMatch(/^✓/)
  await ui.unmount()
})

test('Codex #2: retomada de agente desconhecido mostra o modelo efetivo', async ($, on) => {
  engine(on)
  await iniciar($)
  await $.agent.spawn(spawn('general-purpose', 'Velho', { resume: { agentId: 'zz' } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect((await ui.find({ type: 'Text', text: /Velho/ }))?.text).toMatch(/· Sonnet · retomado/)
  await ui.unmount()
})

test('Codex #3: o histórico volta a 30 quando os agentes terminam', async ($, on) => {
  engine(on)
  await iniciar($)
  for (let i = 0; i < 31; i++) await $.agent.spawn(spawn('general-purpose', `A${i}`))
  for (let i = 1; i <= 31; i++) await fim($, `ag${i}`)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect((await ui.find({ type: 'Text', text: /^30 agentes · 0 rodando/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('Codex #4: nenhuma linha da faixa passa da largura', async ($, on) => {
  engine(on)
  await iniciar($)
  await $.agent.spawn(spawn('general-purpose', 'Um nome de tarefa bem comprido mesmo'))
  await passo($, 'ag1')
  for (const largura of [20, 40, 60, 100]) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: largura }, surface: 'terminal' } as never)
    const linha = await ui.find({ type: 'Text', text: /Um nome/ })
    expect((linha?.text ?? '').length).toBeLessThanOrEqual(largura)
    expect((await ui.find({ type: 'Text', text: /Time de agentes/ }))!.text.length).toBeLessThanOrEqual(largura)
    await ui.unmount()
  }
})

test('Codex #5: dois cliques simultâneos no seletor avançam duas vezes e o store fica com o último', async ($, on) => {
  engine(on)
  await iniciar($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  await Promise.all([ui.press({ key: 'regra-Explore' }), ui.press({ key: 'regra-Explore' })])
  expect((await ui.find({ type: 'Button', text: /^Explore/ }))?.text).toMatch(/sempre Sonnet/)
  await ui.unmount()
  // reload: o atom é recarregado do store, que precisa ter a última escolha
  await iniciar($)
  const depois = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect((await depois.find({ type: 'Button', text: /^Explore/ }))?.text).toMatch(/sempre Sonnet/)
  await depois.unmount()
})

test('Codex #1b: com 30 rodando, um agente que termina antes do spawn resolver não volta como "rodando" e seus tokens contam', async ($, on) => {
  engine(on)
  await iniciar($)
  for (let i = 0; i < 30; i++) await $.agent.spawn(spawn('general-purpose', `R${i}`))
  await $.turn.start({ text: 'p', turnId: 't', agentId: 'ag31' } as never)
  await passo($, 'ag31')
  await fim($, 'ag31')
  await $.agent.spawn(spawn('general-purpose', 'Relâmpago'))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  // histórico cheio de quem roda: o concluído é o que sai, mas nunca volta como ◐ com 0 tokens
  expect((await ui.find({ type: 'Text', text: /^30 agentes · 30 rodando · 1k tokens/ }))?.text).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Relâmpago/ })).toBeFalsy()
  await ui.unmount()
})

test('Codex #1c: retomada de agente conhecido que termina com o histórico cheio não volta como "rodando"', async ($, on) => {
  let liberar = () => {}
  const esperarRetomada = new Promise<void>(r => (liberar = r))
  const { clock } = engine(on, { esperarRetomada })
  await iniciar($)
  await $.agent.spawn(spawn('general-purpose', 'Conhecido'))
  await passo($, 'ag1')
  await fim($, 'ag1')
  for (let i = 0; i < 29; i++) await $.agent.spawn(spawn('general-purpose', `R${i}`))

  const retomada = $.agent.spawn(spawn('general-purpose', 'Conhecido', { resume: { agentId: 'ag1' } }))
  await clock.settle()
  // o 30º chega com a retomada pendente: o histórico enche com o "Conhecido" ainda nele
  await $.agent.spawn(spawn('general-purpose', 'R29'))
  await $.turn.start({ text: 'p', turnId: 't2', agentId: 'ag1' } as never)
  await passo($, 'ag1')
  await fim($, 'ag1')
  liberar()
  await retomada

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect(await ui.find({ type: 'Text', text: /^◐ Conhecido/ })).toBeFalsy()
  expect((await ui.find({ type: 'Text', text: /· 30 rodando · 2k tokens/ }))?.text).toBeTruthy()
  await ui.unmount()
})
