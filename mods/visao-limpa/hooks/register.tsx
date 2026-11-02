import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ConfigVisao } from '../types'
import { linha, resumir } from './descrever'
import type { Acao } from './descrever'

const PADRAO: ConfigVisao = { resumo: true, linhas: true }
const config = atom({ plugin: 'visao-limpa', key: 'config' } as const, PADRAO)
// Linhas compactas que o usuário abriu para ver o detalhe (ids de chamada ou de grupo).
const abertos = atom({ plugin: 'visao-limpa', key: 'abertos' } as const, [])
// Tópicos do último turno com trabalho, mostrados na faixa até o próximo pedido.
const ultimo = atom({ plugin: 'visao-limpa', key: 'ultimo' } as const, null)

// O app desktop já agrupa as ações ("Executou 6 comandos ▸"); as linhas compactas são para o resto.
const COMPACTA_EM = new Set(['vscode', 'terminal'])

async function mudarConfig($: EngineInterface, muda: (c: ConfigVisao) => ConfigVisao): Promise<ConfigVisao> {
  const nova = await update($, config, c => muda({ ...c }))
  await $.store.set('config', nova)
  return nova
}

function estado(c: ConfigVisao): string {
  return `Visão limpa: resumo no fim ${c.resumo ? 'ligado' : 'desligado'} · linhas compactas (VS Code/terminal) ${c.linhas ? 'ligadas' : 'desligadas'}.`
}

async function alternar($: EngineInterface, id: string): Promise<void> {
  await update($, abertos, l => (l.includes(id) ? l.filter(x => x !== id) : [...l, id].slice(-500)))
}

export const register: Register = on => {
  // Ações da conversa principal no turno atual.
  let acoes: Acao[] = []

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'visao',
      description: 'Visão limpa: /visao on|off, /visao resumo on|off, /visao linhas on|off',
      argumentHint: '[on | off | resumo on|off | linhas on|off]',
    })
    const salva = (await $.store.get('config')) as Partial<ConfigVisao> | undefined
    await update($, config, () => ({ ...PADRAO, ...salva }))
    return r
  })

  on('command.run', { command: 'visao' }, async ($, e) => {
    const [a, b] = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const liga = (v?: string) => (v === 'on' ? true : v === 'off' ? false : undefined)
    if (a === undefined) return { text: estado(await read($, config)) }
    if (liga(a) !== undefined) return { text: estado(await mudarConfig($, () => ({ resumo: liga(a)!, linhas: liga(a)! }))) }
    if ((a === 'resumo' || a === 'linhas') && liga(b) !== undefined) {
      return { text: estado(await mudarConfig($, c => ({ ...c, [a]: liga(b)! }))) }
    }
    return { text: 'Use: /visao on|off, /visao resumo on|off ou /visao linhas on|off' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      acoes = []
      await update($, ultimo, () => null)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) acoes.push({ tool: e.tool, input: e, erro: r.deny !== undefined || r.isError === true })
    return r
  })

  // Guarda o resumo do turno para a faixa acima do prompt. (O `{ text }` do turn.complete vira, no app
  // desktop, um aviso recolhido de uma linha só; a faixa fica à vista em todo lugar.)
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return r
    const feitas = acoes
    acoes = []
    if (feitas.length < 2) return r
    const topicos = resumir(feitas)
    if (topicos.length > 0) await update($, ultimo, () => topicos)
    return r
  })

  // "O que eu fiz" na faixa acima do prompt, até o próximo pedido; embrulha as outras faixas.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const abaixo = await next(e)
    // Pesquisa na tela, resumo desligado ou vendo a conversa de um subagente: não é o lugar do resumo principal.
    if (e.props.hasSurvey || e.props.view?.agentId || !(await read($, config)).resumo) return abaixo
    const topicos = await read($, ultimo)
    if (!topicos || topicos.length === 0) return abaixo
    const { Box, Text } = $.ui.resolve(e)
    const minha = (
      <Text dimColor wrap="wrap">
        O que eu fiz: {topicos.join(' · ')}
      </Text>
    )
    return abaixo ? (
      <Box flexDirection="column">
        {abaixo}
        {minha}
      </Box>
    ) : (
      minha
    )
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const c = await read($, config)
    if (!c.linhas || !COMPACTA_EM.has(e.surface) || e.props.isExpanded) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const id = e.props.tool_use_id
    if ((await read($, abertos)).includes(id)) {
      const completo = await next(e)
      return (
        <Box flexDirection="column">
          {completo}
          <Button key={`fechar-${id}`} onPress={() => alternar($, id)}>
            recolher
          </Button>
        </Box>
      )
    }
    const p = e.props
    const icone = p.isRunning ? '◐' : p.isInterrupted ? '⊘' : p.isErrored ? '✕' : '●'
    const cor = p.isRunning ? 'warning' : p.isErrored || p.isInterrupted ? 'error' : 'success'
    return (
      <Box flexDirection="row" gap={1}>
        <Text>
          <Text color={cor}>{icone} </Text>
          {linha(p.tool, p.input, p.isRunning)}
        </Text>
        <Button key={`abrir-${id}`} onPress={() => alternar($, id)}>
          detalhes
        </Button>
      </Box>
    )
  })

  // O bloco de resultado embaixo da linha: escondido enquanto a linha está compacta.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const c = await read($, config)
    if (!c.linhas || !COMPACTA_EM.has(e.surface) || e.props.isExpanded) return next(e)
    if ((await read($, abertos)).includes(e.props.tool_use_id)) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // Grupos de leituras/buscas ("Read 3 files…"): uma linha em português, abrível.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const c = await read($, config)
    const p = e.props
    // Só redesenha um grupo que a API garante ser só de chamadas (isCallsOnly === true).
    if (!c.linhas || !COMPACTA_EM.has(e.surface) || p.isExpanded || p.isCallsOnly !== true || p.calls.length === 0) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const id = `grupo-${p.calls[0]?.tool_use_id ?? p.calls.length}`
    if ((await read($, abertos)).includes(id)) {
      const completo = await next({ ...e, props: { ...p, isExpanded: true } })
      return (
        <Box flexDirection="column">
          {completo}
          <Button key={`fechar-${id}`} onPress={() => alternar($, id)}>
            recolher
          </Button>
        </Box>
      )
    }
    const topicos = resumir(p.calls.map(x => ({ tool: x.tool, input: x.input, erro: x.isErrored })))
    return (
      <Box flexDirection="row" gap={1}>
        <Text>
          <Text color={p.isActive ? 'warning' : 'success'}>{p.isActive ? '◐ ' : '● '}</Text>
          {topicos.join(' · ') || `${p.calls.length} ações`}
        </Text>
        <Button key={`abrir-${id}`} onPress={() => alternar($, id)}>
          detalhes
        </Button>
      </Box>
    )
  })
}
