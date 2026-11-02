import { atom, read, update } from 'claude-code'
import type { AgentSpawnInput, EngineInterface, Register } from 'claude-code'

import type { Agente, EsforcoAgente, ModeloAgente, Regras, Totais } from '../types'
import { REGRAS_PADRAO, escolher, migrarRegras } from './decisao'
import type { Decisao, Fonte } from './decisao'

const PAINEL = 'time-agentes'
const agentes = atom({ plugin: 'time-agentes', key: 'agentes' } as const, [], { shape: 'agentes-1' })
// v0.1 guardava só os tokens da conversa principal aqui; lido uma vez para iniciar `totais`.
const principalAntigo = atom({ plugin: 'time-agentes', key: 'principal' } as const, 0)
const totais = atom({ plugin: 'time-agentes', key: 'totais' } as const, null)
const regras = atom({ plugin: 'time-agentes', key: 'regras' } as const, {})
const ocultos = atom({ plugin: 'time-agentes', key: 'ocultos' } as const, [])
const faixaAte = atom({ plugin: 'time-agentes', key: 'faixaAte' } as const, 0)

const CICLO: (ModeloAgente | null)[] = ['haiku', 'sonnet', 'opus', null]
const NOME_MODELO: Record<ModeloAgente, string> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' }
const FAIXA_MS = 60_000
const HISTORICO = 30

function familia(modelo: string): string {
  const m = modelo.toLowerCase()
  if (m.includes('haiku')) return 'Haiku'
  if (m.includes('sonnet')) return 'Sonnet'
  if (m.includes('opus')) return 'Opus'
  if (m.includes('fable')) return 'Fable'
  return modelo
}

function tokensTexto(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function fracao(parte: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(1, parte / total)) : 0
}

function barra(parte: number, total: number, celulas: number): string {
  const cheio = Math.round(fracao(parte, total) * celulas)
  return '█'.repeat(cheio) + '░'.repeat(celulas - cheio)
}

function pct(parte: number, total: number): string {
  return `${Math.round(fracao(parte, total) * 100)}%`
}

function icone(a: Agente): string {
  return { rodando: '◐', concluido: '✓', erro: '✕', desconhecido: '?' }[a.status]
}

function corDe(a: Agente): 'warning' | 'success' | 'error' | 'subtle' {
  return ({ rodando: 'warning', concluido: 'success', erro: 'error', desconhecido: 'subtle' } as const)[a.status]
}

function porQue(a: Agente): string {
  if (a.atividade) return a.motivo === 'modo' ? `${a.atividade} (/modo)` : a.atividade
  return { pedido: 'pedido', regra: 'sua regra', atividade: 'atividade', modo: '/modo', padrao: 'padrão', retomado: 'retomado' }[
    a.motivo ?? 'padrao'
  ]
}

// Para o painel e o resumo: o motivo com as palavras que decidiram (a faixa usa só o motivo, por espaço).
function porQueDetalhado(a: Agente): string {
  if (a.pistas && a.pistas.length > 0) return `${porQue(a)} (${a.pistas.slice(0, 3).join(', ')})`
  return a.motivo === 'padrao' || a.motivo === undefined ? `${porQue(a)} (sem pista na tarefa)` : porQue(a)
}

function cortar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, Math.max(1, max - 1))}…`
}

function provisorio(id: string, agora: number): Agente {
  return { id, nome: 'agente', tipo: '?', modelo: '?', status: 'rodando', tokens: 0, inicio: agora, fim: null, motivo: 'padrao' }
}

// Agentes com retomada em andamento: o registro (e o contador `fins`) não pode sair até o merge.
const retomando = new Set<string>()

// Acima de HISTORICO sai o concluído mais antigo. Nunca descarta quem está rodando, quem está
// sendo retomado, nem um registro provisório recente (o spawn dele ainda vai completar os dados).
function aparar(lista: Agente[], agora: number): Agente[] {
  let excesso = lista.length - HISTORICO
  if (excesso <= 0) return lista
  return lista.filter(a => {
    const aguardando = a.tipo === '?' && agora - (a.fim ?? a.inicio) < FAIXA_MS
    if (excesso > 0 && a.status !== 'rodando' && !aguardando && !retomando.has(a.id)) {
      excesso -= 1
      return false
    }
    return true
  })
}

function somaTotais(t: Totais | null): number {
  return t ? t.principal + t.agentes : 0
}

// Agentes da tela: sem os escondidos por "Limpar", rodando primeiro, depois os mais recentes.
function visiveis(lista: Agente[], escondidos: string[]): Agente[] {
  const fora = new Set(escondidos)
  return lista
    .filter(a => !fora.has(a.id))
    .sort((x, y) => Number(y.status === 'rodando') - Number(x.status === 'rodando') || (y.fim ?? y.inicio) - (x.fim ?? x.inicio))
}

async function comRegistro($: EngineInterface, id: string, muda: (a: Agente) => Agente): Promise<void> {
  const agora = await $.clock.now()
  await update($, agentes, lista => {
    const i = lista.findIndex(a => a.id === id)
    if (i < 0) return aparar([...lista, muda(provisorio(id, agora))], agora)
    return aparar(
      lista.map((a, j) => (j === i ? muda(a) : a)),
      agora,
    )
  })
}

async function somar($: EngineInterface, onde: keyof Totais, n: number): Promise<void> {
  await update($, totais, t => {
    const base = t ?? { principal: 0, agentes: 0 }
    return { ...base, [onde]: base[onde] + n }
  })
}

async function decidir($: EngineInterface, e: AgentSpawnInput): Promise<Decisao> {
  const minhas = await read($, regras)
  // $.presets vem do painel-controle; sem ele as chamadas falham e vale o padrão por tipo.
  const fonte: Fonte = {
    list: () => $.presets.list(),
    ativo: () => $.presets.ativo(),
    classificar: (titulo, detalhe) => $.presets.classificar({ titulo, detalhe }),
  }
  try {
    return await escolher(e, minhas, fonte)
  } catch {
    return escolher(e, minhas, null)
  }
}

// Mudanças de regra em fila: cada uma calcula sobre o valor mais novo (dois cliques avançam duas vezes)
// e grava no store antes de a próxima começar, então o store nunca fica com uma versão velha.
let filaRegras: Promise<void> = Promise.resolve()

function mudarRegras($: EngineInterface, muda: (r: Regras) => Regras): Promise<void> {
  const vez = filaRegras.then(async () => {
    const novas = await update($, regras, atuais => muda({ ...atuais }))
    await $.store.set('regras-v2', novas)
  })
  filaRegras = vez.catch(() => {})
  return vez
}

function proximoModelo(atual: ModeloAgente | undefined): ModeloAgente | null {
  return CICLO[(CICLO.indexOf(atual ?? null) + 1) % CICLO.length] ?? null
}

function agendarFaixa($: EngineInterface, ms: number): void {
  // Só pede redesenho: quem decide se a faixa aparece é o render, pelo relógio.
  $.clock.after(Math.max(0, ms) + 250, () => $.ui.invalidate('ui.render'))
}

// O mesmo conteúdo do painel, em texto, para quando a tela não tem onde desenhá-lo.
async function resumo($: EngineInterface): Promise<string> {
  const lista = visiveis(await read($, agentes), await read($, ocultos))
  const t = await read($, totais)
  const total = somaTotais(t)
  const r = await read($, regras)
  const rodando = lista.filter(a => a.status === 'rodando').length
  const linhas = [
    `${lista.length} agentes · ${rodando} rodando · ${tokensTexto(total)} tokens no total`,
    `Conversa principal ${barra(t?.principal ?? 0, total, 12)} ${tokensTexto(t?.principal ?? 0)} (${pct(t?.principal ?? 0, total)})`,
    ...lista.map(a => {
      const tempo = a.fim !== null ? ` · ${Math.round((a.fim - a.inicio) / 1000)}s` : ''
      return `${icone(a)} ${a.nome} · ${a.modelo} · ${porQueDetalhado(a)}\n   ${barra(a.tokens, total, 12)} ${tokensTexto(a.tokens)} (${pct(a.tokens, total)})${tempo}`
    }),
    `Suas regras por tipo: ${
      Object.entries(r)
        .map(([tipo, m]) => `${tipo} → ${NOME_MODELO[m]}`)
        .join(', ') || 'nenhuma (escolha automática pela atividade)'
    }`,
  ]
  return linhas.join('\n')
}

export const register: Register = on => {
  // agentId → esforço da atividade escolhida no spawn (também fica no registro, para sobreviver a reload).
  const vinculos = new Map<string, EsforcoAgente>()

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'agentes',
      description: 'Abre o painel do time de agentes. /agentes <tipo> <haiku|sonnet|opus|auto> fixa o modelo de um tipo.',
      argumentHint: '[tipo modelo]',
    })

    // Regras v0.1 → v0.2, uma vez só (a chave regras-v2 marca como feito).
    let minhas = (await $.store.get('regras-v2')) as Regras | undefined
    if (minhas === undefined) {
      const antigas = ((await $.store.get('regras')) as Regras | undefined) ?? {}
      minhas = migrarRegras(antigas)
      await $.store.set('regras-v2', minhas)
      await $.store.delete('regras')
    }
    await update($, regras, () => minhas)

    const lista = await read($, agentes)
    if ((await read($, totais)) === null) {
      const principal = await read($, principalAntigo)
      await update($, totais, () => ({ principal, agentes: lista.reduce((s, a) => s + a.tokens, 0) }))
    }

    // Depois de um reload: quem ficou "rodando" é conferido com a lista do engine.
    if (lista.some(a => a.status === 'rodando')) {
      const doEngine = new Map((await $.agent.list()).map(a => [a.id, a.status]))
      const agora = await $.clock.now()
      await update($, agentes, l =>
        l.map((a): Agente => {
          if (a.status !== 'rodando') return a
          const s = doEngine.get(a.id)
          if (s === undefined) return { ...a, status: 'desconhecido' }
          if (s === 'completed') return { ...a, status: 'concluido', fim: a.fim ?? agora }
          if (s === 'failed' || s === 'killed') return { ...a, status: 'erro', fim: a.fim ?? agora }
          return a
        }),
      )
    }

    const restante = (await read($, faixaAte)) - (await $.clock.now())
    if (restante > 0) agendarFaixa($, restante)
    return r
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      vinculos.clear()
      await update($, agentes, () => [])
      await update($, totais, () => ({ principal: 0, agentes: 0 }))
      await update($, ocultos, () => [])
      await update($, faixaAte, () => 0)
    }
    return next(e)
  })

  on('command.run', { command: 'agentes' }, async ($, e) => {
    const [tipo, modelo] = e.args.trim().split(/\s+/).filter(Boolean)
    if (!tipo) {
      const { isPlaced } = await $.ui.open({ id: PAINEL, title: 'Time de agentes' })
      if (isPlaced) return { text: 'Painel do time de agentes aberto.' }
      return { text: `Esta tela não tem onde mostrar o painel (ex.: sessão aberta dentro da divisão de tela). Resumo:\n${await resumo($)}` }
    }
    if (!modelo) return { text: 'Use: /agentes <tipo> <haiku|sonnet|opus|auto>' }
    const fixo = modelo === 'haiku' || modelo === 'sonnet' || modelo === 'opus' ? modelo : null
    if (!fixo && modelo !== 'auto' && modelo !== 'padrao') {
      return { text: `Modelo "${modelo}" não existe. Use haiku, sonnet, opus ou auto.` }
    }
    await mudarRegras($, r => {
      if (fixo) r[tipo] = fixo
      else delete r[tipo]
      return r
    })
    return {
      text:
        modelo in NOME_MODELO
          ? `${tipo}: sempre no ${NOME_MODELO[modelo as ModeloAgente]} (vence a atividade).`
          : `${tipo}: modelo automático (pela atividade da tarefa).`,
    }
  })

  on('agent.spawn', async ($, e, next) => {
    if (e.resume) {
      // Retomada: o engine ignora troca de modelo; o agente volta a "rodando",
      // a menos que esta mesma execução já tenha terminado antes de o spawn resolver.
      const retomado = e.resume.agentId
      retomando.add(retomado)
      try {
        const finsAntes = (await read($, agentes)).find(a => a.id === retomado)?.fins ?? 0
        const res = await next(e)
        if (res.deny === undefined) {
          const id = res.agentId ?? retomado
          await comRegistro($, id, a => {
            const terminouAgora = (a.fins ?? 0) > finsAntes
            return {
              ...a,
              status: terminouAgora ? a.status : 'rodando',
              fim: terminouAgora ? a.fim : null,
              nome: a.nome === 'agente' ? e.description || e.subagentType : a.nome,
              tipo: a.tipo === '?' ? e.subagentType : a.tipo,
              modelo: a.modelo === '?' && res.model ? familia(res.model) : a.modelo,
              motivo: a.tipo === '?' ? 'retomado' : a.motivo,
            }
          })
          await update($, ocultos, l => l.filter(x => x !== id))
        }
        return res
      } finally {
        retomando.delete(retomado)
      }
    }

    const d = await decidir($, e)
    const res = await next(d.modelo ? { ...e, model: d.modelo } : e)
    if (res.deny !== undefined || !res.agentId) return res

    const id = res.agentId
    if (d.esforco) vinculos.set(id, d.esforco)
    // Completa o registro sem mexer em tokens, status e fim: eventos do agente podem ter chegado antes.
    await comRegistro($, id, a => ({
      ...a,
      nome: e.description || e.subagentType,
      tipo: e.subagentType,
      modelo: familia(res.model ?? d.modelo ?? e.parentModel),
      motivo: d.motivo,
      atividade: d.atividade,
      esforco: d.esforco,
      pistas: d.pistas,
    }))
    return res
  })

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    const id = e.agentId
    if (id !== undefined) {
      await comRegistro($, id, a => (a.status === 'rodando' ? a : { ...a, status: 'rodando', fim: null }))
      await update($, ocultos, l => l.filter(x => x !== id))
    }
    return r
  })

  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    let pedido = e
    if (id !== undefined && e.effort !== undefined) {
      const esforco = vinculos.get(id) ?? (await read($, agentes)).find(a => a.id === id)?.esforco
      if (esforco) pedido = { ...e, effort: esforco }
    }
    const r = yield* next(pedido)
    const u = r.usage
    if (u) {
      const n = u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      if (id === undefined) {
        await somar($, 'principal', n)
      } else {
        await comRegistro($, id, a => ({ ...a, tokens: a.tokens + n }))
        await somar($, 'agentes', n)
      }
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const id = e.agentId
    if (id !== undefined) {
      const agora = await $.clock.now()
      const status: Agente['status'] = e.reason === 'answer' ? 'concluido' : 'erro'
      await comRegistro($, id, a => ({ ...a, status, fim: agora, fins: (a.fins ?? 0) + 1 }))
      vinculos.delete(id)
      await update($, faixaAte, () => agora + FAIXA_MS)
      agendarFaixa($, FAIXA_MS)
    }
    return r
  })

  // Faixa acima do prompt: embrulha o que vem de baixo (ex.: barra-creditos), nunca apaga.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const abaixo = await next(e)
    if (e.props.hasSurvey) return abaixo

    const lista = visiveis(await read($, agentes), await read($, ocultos))
    const rodando = lista.filter(a => a.status === 'rodando').length
    const ate = await read($, faixaAte)
    if (lista.length === 0 || (rodando === 0 && (await $.clock.now()) >= ate)) return abaixo

    const { Box, Text } = $.ui.resolve(e)
    const total = somaTotais(await read($, totais))
    const largura = e.props.bodyColumns
    const cabecalho = `Time de agentes · ${rodando} rodando · ${tokensTexto(total)} tokens · /agentes`
    const detalhado = e.props.maxRows >= 10
    const mostrados = detalhado ? lista.slice(0, 3) : []
    const celulas = largura >= 80 ? 12 : largura >= 60 ? 6 : 0

    const minha = (
      <Box flexDirection="column">
        <Text dimColor>{cortar(cabecalho, largura)}</Text>
        {mostrados.map(a => {
          let cauda = ` ${tokensTexto(a.tokens)} ${pct(a.tokens, total)}`
          let meio = ` · ${a.modelo} · ${porQue(a)}`
          let cel = celulas
          // Tira partes, da menos para a mais importante, até a linha caber em `largura` sem quebrar.
          const espaco = () => largura - 2 - meio.length - (cel > 0 ? cel + 1 : 0) - cauda.length
          if (espaco() < 12) meio = ` · ${a.modelo}`
          if (espaco() < 12) cel = 0
          if (espaco() < 8) meio = ''
          if (espaco() < 6) cauda = ''
          return (
            <Text key={a.id}>
              <Text color={corDe(a)}>{icone(a)} </Text>
              <Text weight="semibold">{cortar(a.nome, Math.max(1, espaco()))}</Text>
              <Text dimColor>{meio}</Text>
              {cel > 0 && <Text color="claude" mono>{` ${barra(a.tokens, total, cel)}`}</Text>}
              <Text dimColor tabular>
                {cauda}
              </Text>
            </Text>
          )
        })}
        {lista.length > mostrados.length && mostrados.length > 0 && <Text dimColor>+{lista.length - mostrados.length} no /agentes</Text>}
      </Box>
    )

    return abaixo ? (
      <Box flexDirection="column">
        {minha}
        {abaixo}
      </Box>
    ) : (
      minha
    )
  })

  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const lista = visiveis(await read($, agentes), await read($, ocultos))
    const t = await read($, totais)
    const total = somaTotais(t)
    const r = await read($, regras)
    const rodando = lista.filter(a => a.status === 'rodando').length
    const tipos = [...new Set([...Object.keys(REGRAS_PADRAO), ...Object.keys(r), ...lista.map(a => a.tipo).filter(x => x !== '?')])]

    return (
      <Box flexDirection="column" gap={1}>
        <Text weight="semibold">
          {lista.length} agentes · {rodando} rodando · {tokensTexto(total)} tokens no total
        </Text>

        <Box flexDirection="column">
          <Text>
            <Text weight="semibold">Conversa principal </Text>
            <Text color="claude" mono>
              {barra(t?.principal ?? 0, total, 16)}
            </Text>
            <Text dimColor tabular>
              {' '}
              {tokensTexto(t?.principal ?? 0)} ({pct(t?.principal ?? 0, total)})
            </Text>
          </Text>
          {lista.length === 0 && <Text dimColor>Nenhum subagente ainda. Eles aparecem aqui quando eu delegar uma tarefa.</Text>}
          {lista.map(a => (
            <Box key={a.id} flexDirection="column">
              <Text>
                <Text color={corDe(a)}>{icone(a)} </Text>
                <Text weight="semibold">{a.nome}</Text>
                <Text dimColor>
                  {' '}
                  · {a.tipo} · {a.modelo} · {porQueDetalhado(a)}
                </Text>
              </Text>
              <Text>
                {'  '}
                <Text color="claude" mono>
                  {barra(a.tokens, total, 16)}
                </Text>
                <Text dimColor tabular>
                  {' '}
                  {tokensTexto(a.tokens)} ({pct(a.tokens, total)}){a.fim !== null ? ` · ${Math.round((a.fim - a.inicio) / 1000)}s` : ''}
                </Text>
              </Text>
            </Box>
          ))}
        </Box>

        <Box flexDirection="column">
          <Text weight="semibold">Modelo por tipo de agente</Text>
          <Text dimColor>Automático = pela atividade da tarefa (presets do /modo). Clique: Haiku → Sonnet → Opus → automático</Text>
          {tipos.map(tipo => {
            const atual = r[tipo] ?? null
            return (
              <Button
                key={`regra-${tipo}`}
                onPress={() =>
                  mudarRegras($, novas => {
                    const prox = proximoModelo(novas[tipo])
                    if (prox === null) delete novas[tipo]
                    else novas[tipo] = prox
                    return novas
                  })
                }
              >
                {tipo} <Text dimColor>{atual ? `sempre ${NOME_MODELO[atual]}` : 'automático'}</Text>
              </Button>
            )
          })}
        </Box>

        {lista.some(a => a.status !== 'rodando') && (
          <Button
            key="limpar"
            onPress={async () => {
              const prontos = (await read($, agentes)).filter(a => a.status !== 'rodando').map(a => a.id)
              await update($, ocultos, l => [...new Set([...l, ...prontos])])
            }}
          >
            Limpar concluídos
          </Button>
        )}
      </Box>
    )
  })
}
