import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'barra-creditos',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
  },
} as const

test('mostra as barras e o gasto depois de uma medição', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.status', () => ({ value: undefined }) as never)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('prompt.submit', (_, e) => e)

  await $.session.measure({
    context: { windowTokens: 200000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 24, resetsAt: '2026-11-02T18:00:00Z' }],
    cost: { usd: 1.0 },
    changed: ['cost', 'rateLimits'],
  } as never)
  await $.prompt.submit({ text: 'oi' } as never)
  await $.session.measure({
    context: { windowTokens: 200000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: '2026-11-02T18:00:00Z' }],
    cost: { usd: 1.25 },
    changed: ['cost'],
  } as never)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect((await ui.find({ type: 'Text', text: /70% restante/ }))?.text).toContain('Limite 5h')
  expect((await ui.find({ type: 'Text', text: /Gasto nesta sessão/ }))?.text).toBe(
    'Gasto nesta sessão: US$ 1.25 · último prompt: −US$ 0.25',
  )
  await ui.unmount()
})

test('antes da primeira leitura mostra o aviso', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.status', () => ({ value: undefined }) as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect((await ui.find({ type: 'Text' }))?.text).toMatch(/aguardando a primeira leitura/)
  await ui.unmount()
})

test('divide a faixa com o que vem de baixo, sem apagar', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>outro mod</Text>
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect((await ui.find({ type: 'Text', text: /aguardando a primeira leitura/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /outro mod/ }))?.text).toBe('outro mod')
    await ui.unmount()
  }
})

test('durante uma pesquisa (survey) passa a faixa adiante', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>survey</Text>
  })
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'desktop' } as never)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('survey')
  await ui.unmount()
})
