import { expect, mock, test } from 'claude-code/testing'

const TOOL = {
  plugin: 'visao-limpa',
  component: 'ToolUse',
  requestId: 'tu1',
  props: {
    tool_use_id: 'tu1',
    tool: 'Edit',
    input: { file_path: '/p/Hero.tsx', old_string: 'a', new_string: 'a\nb' },
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
    isExpanded: false,
  },
} as const

const RESULT = {
  plugin: 'visao-limpa',
  component: 'ToolResult',
  requestId: 'tu1',
  props: { tool_use_id: 'tu1', tool: 'Edit', output: {}, isErrored: false, isExpanded: false },
} as const

const GROUP = {
  plugin: 'visao-limpa',
  component: 'ToolGroup',
  requestId: 'g',
  props: {
    isActive: false,
    isExpanded: false,
    isCallsOnly: true,
    calls: [
      { tool_use_id: 'r1', tool: 'Read', input: { file_path: '/p/a.ts' }, isRunning: false, isErrored: false, isInterrupted: false },
      { tool_use_id: 'r2', tool: 'Grep', input: { pattern: 'x' }, isRunning: false, isErrored: false, isInterrupted: false },
    ],
  },
} as const

function engine(on: any) {
  mock.store(on)
  on('command.register', () => ({ value: { command: 'visao' } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'resposta' }))
  on('tool.call', (_: unknown, e: { tool: string }) => (e.tool === 'Bash' && (e as any).command === 'falha' ? { result: {}, text: 'x', isError: true } : { result: {}, text: 'ok', isError: false }))
  // O que o engine desenha quando o mod passa a vez.
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`engine ${e.component}${e.props.isExpanded ? ' aberto' : ''}`}</Text>
  })
}

const iniciar = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

const BAND = {
  plugin: 'visao-limpa',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 } },
} as const

const fimTurno = ($: any, turnId: string, reason = 'answer') =>
  $.turn.complete({ turnId, answer: 'r', durationMs: 1, isAborted: reason !== 'answer', reason } as never)

async function textoDaFaixa($: any, surface = 'desktop'): Promise<string | undefined> {
  const ui = await $.ui.mount({ ...BAND, surface } as never)
  const t = (await ui.find({ type: 'Text', text: /O que eu fiz/ }))?.text
  await ui.unmount()
  return t
}

test('"O que eu fiz" aparece na faixa acima do prompt, junto das outras faixas, até o próximo pedido', async ($, on) => {
  engine(on)
  await iniciar($)
  await $.turn.start({ text: 'oi', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/page.tsx' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/p/page.tsx', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Bash', command: 'falha' } as never)
  const r = await fimTurno($, 't1')
  // a resposta em si não é tocada
  expect(r.text).toBe('resposta')

  for (const surface of ['desktop', 'terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect((await ui.find({ type: 'Text', text: /O que eu fiz/ }))?.text).toBe(
      'O que eu fiz: Leu 1 arquivo (page.tsx) · Editou page.tsx (+1 −1) · Rodou 1 comando · 1 falhou',
    )
    expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine AbovePrompt')
    await ui.unmount()
  }

  await $.turn.start({ text: 'próximo', turnId: 't2' } as never)
  expect(await textoDaFaixa($)).toBeUndefined()
})

test('turno com menos de 2 ações, de subagente ou interrompido não ganha resumo; /visao resumo off esconde', async ($, on) => {
  engine(on)
  await iniciar($)
  await $.turn.start({ text: 'oi', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/a.ts' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/b.ts', agentId: 'ag1' } as never)
  await fimTurno($, 't1')
  expect(await textoDaFaixa($)).toBeUndefined()

  await $.turn.start({ text: 'oi', turnId: 't2' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/a.ts' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/b.ts' } as never)
  await fimTurno($, 't2', 'aborted')
  expect(await textoDaFaixa($)).toBeUndefined()

  await $.turn.start({ text: 'oi', turnId: 't3' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/a.ts' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/b.ts' } as never)
  await fimTurno($, 't3')
  expect(await textoDaFaixa($)).toBe('O que eu fiz: Leu 2 arquivos (a.ts, b.ts)')
  await $.command.run({ command: 'visao', args: 'resumo off' } as never)
  expect(await textoDaFaixa($)).toBeUndefined()
})

test('VS Code e terminal: a ação vira uma linha curta, e "detalhes" mostra a original', async ($, on) => {
  engine(on)
  await iniciar($)
  for (const surface of ['vscode', 'terminal'] as const) {
    const linha = await $.ui.mount({ ...TOOL, surface } as never)
    expect((await linha.find({ type: 'Text', text: /Editou/ }))?.text).toBe('● Editou Hero.tsx (+2 −1)')
    const resultado = await $.ui.mount({ ...RESULT, surface } as never)
    expect(await resultado.find({ type: 'Text' })).toBeFalsy()

    await linha.press({ key: 'abrir-tu1' })
    expect((await linha.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine ToolUse')
    expect((await resultado.find({ type: 'Text' }))?.text).toBe('engine ToolResult')
    await linha.press({ key: 'fechar-tu1' })
    expect((await linha.find({ type: 'Text', text: /Editou/ }))?.text).toBeTruthy()
    await linha.unmount()
    await resultado.unmount()
  }
})

test('no app desktop (que já agrupa sozinho) e no ctrl+o nada muda', async ($, on) => {
  engine(on)
  await iniciar($)
  const desk = await $.ui.mount({ ...TOOL, surface: 'desktop' } as never)
  expect((await desk.find({ type: 'Text' }))?.text).toBe('engine ToolUse')
  await desk.unmount()
  const expandido = await $.ui.mount({ ...TOOL, props: { ...TOOL.props, isExpanded: true }, surface: 'vscode' } as never)
  expect((await expandido.find({ type: 'Text' }))?.text).toBe('engine ToolUse aberto')
  await expandido.unmount()
})

test('grupos de leitura viram uma linha em português e abrem no lugar', async ($, on) => {
  engine(on)
  await iniciar($)
  const g = await $.ui.mount({ ...GROUP, surface: 'vscode' } as never)
  expect((await g.find({ type: 'Text', text: /Leu/ }))?.text).toBe('● Leu 1 arquivo (a.ts) · Buscou 1 vez no projeto')
  await g.press({ key: 'abrir-grupo-r1' })
  expect((await g.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine ToolGroup aberto')
  await g.unmount()
})

test('/visao liga e desliga as partes, e a escolha fica salva', async ($, on) => {
  engine(on)
  await iniciar($)
  const r = (await $.command.run({ command: 'visao', args: 'linhas off' } as never)) as { text: string }
  expect(r.text).toMatch(/resumo no fim ligado · linhas compactas \(VS Code\/terminal\) desligadas/)
  const linha = await $.ui.mount({ ...TOOL, surface: 'vscode' } as never)
  expect((await linha.find({ type: 'Text' }))?.text).toBe('engine ToolUse')
  await linha.unmount()

  await iniciar($)
  expect(((await $.command.run({ command: 'visao', args: '' } as never)) as { text: string }).text).toMatch(/desligadas/)
})

test('grupo sem a garantia isCallsOnly fica com o engine', async ($, on) => {
  engine(on)
  await iniciar($)
  const { isCallsOnly: _, ...semMarca } = GROUP.props
  const g = await $.ui.mount({ ...GROUP, props: semMarca, surface: 'vscode' } as never)
  expect((await g.find({ type: 'Text' }))?.text).toBe('engine ToolGroup')
  await g.unmount()
})

test('vendo a conversa de um subagente, a faixa não mostra o resumo da principal', async ($, on) => {
  engine(on)
  await iniciar($)
  await $.turn.start({ text: 'oi', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/a.ts' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/b.ts' } as never)
  await fimTurno($, 't1')
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, view: { agentId: 'ag1' } }, surface: 'desktop' } as never)
  expect(await ui.find({ type: 'Text', text: /O que eu fiz/ })).toBeFalsy()
  await ui.unmount()
})
