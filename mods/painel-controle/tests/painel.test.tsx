import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'painel-controle',
  component: 'Pane',
  requestId: 'painel-controle',
  props: {
    title: 'Painel de controle',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('/modo video troca modelo e esforço só nos pedidos da conversa principal, sem gravar config', async ($, on) => {
  on('ui.status', () => ({ value: undefined }) as never)
  const gravados: unknown[] = []
  const pedidos: unknown[] = []
  on('config.set', (_, e) => {
    gravados.push(e.value)
    return { value: e.value }
  })
  on('turn.step', async function* (_, e) {
    pedidos.push(`${e.model}/${e.effort}`)
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })

  const r = await $.command.run({ command: 'modo', args: 'video' } as never)
  expect((r as { text: string }).text).toMatch(/^Modo Vídeo: Opus · alto/)
  expect(gravados).toEqual([])

  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'haiku', effort: 'medium', messageCount: 1 } as never)) {}
  for await (const _ of $.turn.step({ turnId: 't', index: 1, model: 'haiku', effort: 'medium', messageCount: 1, agentId: 'a1' } as never)) {}
  expect(pedidos).toEqual(['opus/high', 'haiku/medium'])

  await $.command.run({ command: 'modo', args: 'off' } as never)
  for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'haiku', effort: 'medium', messageCount: 1 } as never)) {}
  expect(pedidos[2]).toBe('haiku/medium')
})

test('o painel lista os presets e marca o ativo', async ($, on) => {
  on('config.set', (_, e) => ({ value: e.value }))
  await $.command.run({ command: 'modo', args: 'pesquisa' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect((await ui.find({ type: 'Button', text: /Pesquisa/ }))?.text).toContain('●')
  expect((await ui.find({ type: 'Button', text: /Vídeo/ }))?.text).toContain('○')
  await ui.unmount()
})

test('nome desconhecido devolve a lista de opções', async $ => {
  const r = await $.command.run({ command: 'modo', args: 'xyz' } as never)
  expect((r as { text: string }).text).toMatch(/Não conheço "xyz"/)
})
