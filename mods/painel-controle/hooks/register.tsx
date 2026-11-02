import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Presets } from '../types'
import { NOME_ESFORCO, NOME_MODELO, PRESETS, acharPreset, classificar, rotulo } from './presets'
import type { Preset } from './presets'

const PAINEL = 'painel-controle'
const ATIVO = { plugin: 'painel-controle', key: 'ativo' } as const
const ativo = atom(ATIVO, null)

// Só a conversa atual muda: o modelo e o esforço são trocados em cada pedido (turn.step),
// nada é gravado nas configurações do usuário.
async function aplicar($: EngineInterface, p: Preset): Promise<string> {
  await update($, ativo, () => p.id)
  $.ui.status(`Modo ${rotulo(p)}`)
  return `Modo ${rotulo(p)} (vale a partir do próximo prompt, só nesta conversa)`
}

async function desligar($: EngineInterface): Promise<string> {
  await update($, ativo, () => null)
  $.ui.status(undefined)
  return 'Preset desligado: volta o modelo e o esforço escolhidos no seletor.'
}

function lista(): string {
  return PRESETS.map(p => `• /modo ${p.id}: ${rotulo(p)} (${p.uso})`).join('\n')
}

export const register: Register = on => {
  // Oferece os presets a outros mods como $.presets (o time-agentes usa para escolher o modelo de cada agente).
  on('engine.create', async (_, e, next) => {
    const built = await next(e)
    const presets: Presets = {
      list: async () => PRESETS,
      ativo: async () => {
        const { value: id } = await built.state.get(ATIVO)
        return (id && acharPreset(id)) || null
      },
      // Um objeto só: entre plugins, um método de noun leva um único argumento.
      classificar: async ({ titulo, detalhe }) => classificar(titulo, detalhe),
    }
    return { ...built, presets }
  })

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'modo',
      description: 'Escolhe o preset de atividade (modelo + esforço). Sem nome, abre o painel.',
      argumentHint: '[video | site | automacao | pesquisa | copy | ... | off]',
    })
    const id = await read($, ativo)
    const p = id ? acharPreset(id) : undefined
    if (p) $.ui.status(`Modo ${rotulo(p)}`)
    return r
  })

  on('command.run', { command: 'modo' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === '') {
      await $.ui.open({ id: PAINEL, title: 'Painel de controle' })
      return { text: `Painel aberto. Ou digite direto:\n${lista()}\n• /modo off: desliga o preset` }
    }
    if (arg === 'off') return { text: await desligar($) }
    const p = acharPreset(arg)
    if (!p) return { text: `Não conheço "${arg}". Opções:\n${lista()}` }
    return { text: await aplicar($, p) }
  })

  // O preset vale para cada pedido da conversa principal; os subagentes ficam como estão.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const id = await read($, ativo)
    const p = id ? acharPreset(id) : undefined
    return yield* next(p ? { ...e, model: p.modelo, effort: p.esforco } : e)
  })

  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const id = await read($, ativo)

    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Escolha a atividade: o modelo e o esforço trocam sozinhos.</Text>
        {PRESETS.map((p, i) => (
          <Box key={p.id} flexDirection="column">
            <Button
              key={p.id}
              hotkey={i < 9 ? String(i + 1) : undefined}
              onPress={async () => {
                const msg = await aplicar($, p)
                $.ui.toast(msg)
              }}
            >
              {id === p.id ? '● ' : '○ '}
              {p.nome}{' '}
              <Text dimColor>
                {NOME_MODELO[p.modelo]} · {NOME_ESFORCO[p.esforco]}
              </Text>
            </Button>
            <Text dimColor>{p.uso}</Text>
          </Box>
        ))}
        {id !== null && (
          <Button key="off" onPress={async () => $.ui.toast(await desligar($))}>
            Desligar preset
          </Button>
        )}
      </Box>
    )
  })
}
