import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Leitura, Limite } from '../types'

const leitura = atom({ plugin: 'barra-creditos', key: 'leitura' } as const, null)
const oculta = atom({ plugin: 'barra-creditos', key: 'oculta' } as const, false)

const LARGURA = 24

const NOMES: Record<string, string> = {
  five_hour: 'Limite 5h',
  seven_day: 'Limite semanal',
  spend_limit: 'Limite de gasto',
}

function barra(restante: number): string {
  const cheio = Math.round((Math.max(0, Math.min(100, restante)) / 100) * LARGURA)
  return '█'.repeat(cheio) + '░'.repeat(LARGURA - cheio)
}

function cor(restante: number): 'success' | 'warning' | 'error' {
  if (restante > 50) return 'success'
  if (restante >= 20) return 'warning'
  return 'error'
}

function quando(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dois = (n: number) => String(n).padStart(2, '0')
  return ` · renova ${d.getDate()}/${d.getMonth() + 1} ${dois(d.getHours())}:${dois(d.getMinutes())}`
}

function usd(valor: number): string {
  return `US$ ${valor.toFixed(2)}`
}

export const register: Register = on => {
  // Custo da sessão no momento em que o prompt atual foi enviado.
  let custoNoEnvio: number | null = null

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'creditos', description: 'Mostra ou esconde a barra de créditos' })
    const uso = await $.session.usage()
    if (uso.rateLimits.length > 0 || uso.cost) {
      await update($, leitura, (antes): Leitura => ({
        limites: uso.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
        gastoSessaoUsd: uso.cost?.usd ?? 0,
        gastoUltimoPromptUsd: antes?.gastoUltimoPromptUsd ?? null,
      }))
    }
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      custoNoEnvio = (await read($, leitura))?.gastoSessaoUsd ?? (await $.session.usage()).cost?.usd ?? 0
    } catch {
      custoNoEnvio = null
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const gasto = e.cost?.usd ?? 0
    const limites: Limite[] = e.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))
    await update($, leitura, (antes): Leitura => ({
      limites: limites.length > 0 ? limites : antes?.limites ?? [],
      gastoSessaoUsd: gasto,
      gastoUltimoPromptUsd: custoNoEnvio === null ? antes?.gastoUltimoPromptUsd ?? null : gasto - custoNoEnvio,
    }))
    // Linha de status curta: o VS Code não desenha a faixa acima do prompt.
    const partes = limites.map(x => `${NOMES[x.kind] ?? x.kind}: ${Math.round(100 - x.percentUsed)}% restante`)
    $.ui.status([...partes, `sessão ${usd(gasto)}`].join(' · '))
    return next(e)
  })

  on('command.run', { command: 'creditos' }, async ($, e, next) => {
    const agora = await read($, oculta)
    await update($, oculta, () => !agora)
    return { text: agora ? 'Barra de créditos visível.' : 'Barra de créditos escondida. Use /creditos para mostrar de novo.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Embrulha o que vem de baixo (ex.: time-agentes): a faixa é dividida, nunca apagada.
    const abaixo = await next(e)
    if (e.props.hasSurvey || (await read($, oculta))) return abaixo

    const l = await read($, leitura)
    const { Box, Text } = $.ui.resolve(e)
    const juntar = (minha: JSX.Element) =>
      abaixo ? (
        <Box flexDirection="column">
          {minha}
          {abaixo}
        </Box>
      ) : (
        minha
      )

    if (l === null) {
      return juntar(<Text dimColor>Créditos: aguardando a primeira leitura dos limites (aparece depois da 1ª resposta)</Text>)
    }

    const largura = Math.max(...l.limites.map(x => (NOMES[x.kind] ?? x.kind).length), 0)

    return juntar(
      <Box flexDirection="column">
        {l.limites.map(x => {
          const restante = Math.round((100 - x.percentUsed) * 10) / 10
          const nome = (NOMES[x.kind] ?? x.kind).padEnd(largura)
          return (
            <Text key={x.kind}>
              <Text weight="semibold">{nome} </Text>
              <Text color={cor(restante)} mono>{barra(restante)}</Text>
              <Text color={cor(restante)} tabular> {restante}% restante</Text>
              <Text dimColor>{quando(x.resetsAt)}</Text>
            </Text>
          )
        })}
        <Text dimColor>
          Gasto nesta sessão: {usd(l.gastoSessaoUsd)}
          {l.gastoUltimoPromptUsd !== null ? ` · último prompt: −${usd(l.gastoUltimoPromptUsd)}` : ''}
        </Text>
      </Box>,
    )
  })
}
