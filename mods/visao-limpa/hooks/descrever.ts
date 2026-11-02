// Descreve as ações das ferramentas em português curto, para as linhas compactas e o resumo do turno.

export type Acao = { tool: string; input: unknown; erro: boolean }

type Campos = Record<string, unknown>

const LEITURA = new Set(['Read', 'NotebookRead'])
const BUSCA = new Set(['Grep', 'Glob', 'LS'])
const EDICAO = new Set(['Edit', 'MultiEdit', 'NotebookEdit'])
const COMANDO = new Set(['Bash', 'PowerShell'])
const WEB = new Set(['WebFetch', 'WebSearch'])
// Ferramentas de controle da própria interface: não são "trabalho" para o resumo.
const RUIDO = /^(TodoWrite|ToolSearch|mcp__ccd_)/

// Um executor de testes na posição de comando (o início de um trecho), nunca como argumento.
const EXECUTOR_TESTE =
  /^((npm|pnpm|yarn|bun) (run )?test\b|npm t\b|(npx |bunx |pnpm dlx )?(jest|vitest|mocha|pytest|playwright test)\b|python3? -m (pytest|unittest)\b|claude plugin test\b|(go|cargo|dotnet|deno) test\b)/i

// Separa um comando de shell nos trechos entre ;, & e | que estão fora de aspas (com \ escapando).
export function trechos(comando: string): string[] {
  const partes: string[] = []
  let atual = ''
  let aspa: string | null = null
  for (let i = 0; i < comando.length; i++) {
    const ch = comando[i]!
    if (ch === '\\' && aspa !== "'") {
      atual += ch + (comando[i + 1] ?? '')
      i += 1
    } else if (aspa) {
      if (ch === aspa) aspa = null
      atual += ch
    } else if (ch === '"' || ch === "'") {
      aspa = ch
      atual += ch
    } else if (ch === ';' || ch === '&' || ch === '|') {
      partes.push(atual)
      atual = ''
    } else {
      atual += ch
    }
  }
  partes.push(atual)
  return partes.map(p => p.trim()).filter(Boolean)
}

// "Rodou os testes" só quando um dos trechos chama um executor de testes:
// `cd x && pytest` sim; `ls tests`, `echo npm test`, `echo "x; npm test"` não.
export function ehTeste(comando: string): boolean {
  return trechos(comando).some(trecho => EXECUTOR_TESTE.test(semAtribuicoes(trecho)))
}

// Tira atribuições do início (`CI=1 FOO="a b" npm test` → `npm test`), respeitando aspas e escapes no valor.
export function semAtribuicoes(trecho: string): string {
  let resto = trecho.trim()
  for (;;) {
    const nome = /^[A-Za-z_][A-Za-z0-9_]*=/.exec(resto)
    if (!nome) return resto
    let i = nome[0].length
    let aspa: string | null = null
    for (; i < resto.length; i++) {
      const ch = resto[i]!
      if (ch === '\\' && aspa !== "'") i += 1
      else if (aspa) {
        if (ch === aspa) aspa = null
      } else if (ch === '"' || ch === "'") aspa = ch
      else if (/\s/.test(ch)) break
    }
    // Atribuição sozinha (sem comando depois) não é executor.
    if (i >= resto.length) return ''
    resto = resto.slice(i).trimStart()
  }
}

function campos(input: unknown): Campos {
  return input && typeof input === 'object' ? (input as Campos) : {}
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function nomeArquivo(caminho: string): string {
  const partes = caminho.split(/[\\/]/).filter(Boolean)
  return partes[partes.length - 1] ?? caminho
}

function linhas(s: string): number {
  return s === '' ? 0 : s.split('\n').length
}

// Linhas tiradas e postas por uma edição (aproximado: conta as linhas do trecho trocado).
export function diff(tool: string, input: unknown): { mais: number; menos: number } {
  const c = campos(input)
  if (tool === 'Write') return { mais: linhas(texto(c.content)), menos: 0 }
  if (tool === 'MultiEdit' && Array.isArray(c.edits)) {
    return (c.edits as Campos[]).reduce<{ mais: number; menos: number }>(
      (t, ed) => ({ mais: t.mais + linhas(texto(ed.new_string)), menos: t.menos + linhas(texto(ed.old_string)) }),
      { mais: 0, menos: 0 },
    )
  }
  return { mais: linhas(texto(c.new_string)), menos: linhas(texto(c.old_string)) }
}

function servidorMcp(tool: string): string {
  // mcp__<servidor>__<ferramenta>: o servidor pode ser um id; a ferramenta diz mais.
  const [, servidor = '', nome = ''] = tool.split('__')
  return /^[0-9a-f-]{20,}$/.test(servidor) ? nome : `${servidor} ${nome}`.trim()
}

function cortar(s: string, max: number): string {
  const umaLinha = s.replace(/\s+/g, ' ').trim()
  return umaLinha.length <= max ? umaLinha : `${umaLinha.slice(0, max - 1)}…`
}

// Uma linha por ação, para o VS Code e o terminal.
export function linha(tool: string, input: unknown, emAndamento = false): string {
  const c = campos(input)
  const arquivo = nomeArquivo(texto(c.file_path) || texto(c.notebook_path) || texto(c.path))
  if (LEITURA.has(tool)) return `${emAndamento ? 'Lendo' : 'Leu'} ${arquivo}`
  if (tool === 'Grep') return `Buscou "${cortar(texto(c.pattern), 40)}"${c.path ? ` em ${nomeArquivo(texto(c.path))}` : ''}`
  if (tool === 'Glob') return `Procurou arquivos ${cortar(texto(c.pattern), 40)}`
  if (tool === 'LS') return `Listou ${arquivo || 'a pasta'}`
  if (EDICAO.has(tool) || tool === 'Write') {
    const { mais, menos } = diff(tool, input)
    const verbo = tool === 'Write' ? (emAndamento ? 'Escrevendo' : 'Escreveu') : emAndamento ? 'Editando' : 'Editou'
    return `${verbo} ${arquivo} (+${mais} −${menos})`
  }
  if (COMANDO.has(tool)) {
    const oQue = texto(c.description) || texto(c.command)
    return `${emAndamento ? 'Rodando' : 'Rodou'}: ${cortar(oQue, 60)}`
  }
  if (tool === 'Agent' || tool === 'Task') return `Delegou: ${cortar(texto(c.description) || 'subagente', 50)}`
  if (tool === 'WebSearch') return `Pesquisou na web: ${cortar(texto(c.query), 50)}`
  if (tool === 'WebFetch') return `Abriu ${cortar(texto(c.url).replace(/^https?:\/\//, ''), 50)}`
  if (tool === 'Skill') return `Usou a skill ${texto(c.skill)}`
  if (tool.startsWith('mcp__')) return `Usou ${servidorMcp(tool)}`
  return `Usou ${tool}`
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`
}

function listaNomes(nomes: string[], max = 3): string {
  const unicos = [...new Set(nomes)]
  const mostrados = unicos.slice(0, max).join(', ')
  return unicos.length > max ? `${mostrados}, +${unicos.length - max}` : mostrados
}

// O resumo "O que eu fiz" de um turno: um tópico por tipo de trabalho, na ordem em que aparecem.
export function resumir(acoes: Acao[]): string[] {
  const uteis = acoes.filter(a => !RUIDO.test(a.tool))
  const lidos: string[] = []
  let buscas = 0
  // Chave = caminho completo (dois index.ts de pastas diferentes não se somam); o nome curto é só para mostrar.
  const editados = new Map<string, { nome: string; mais: number; menos: number; criado: boolean }>()
  let falhasArquivo = 0
  const comandos = { total: 0, falhas: 0 }
  const testes = { total: 0, falhas: 0 }
  const delegados: string[] = []
  let web = 0
  const outros = new Map<string, number>()

  for (const a of uteis) {
    const c = campos(a.input)
    const caminho = texto(c.file_path) || texto(c.notebook_path)
    const arquivo = nomeArquivo(caminho)
    const mexeArquivo = LEITURA.has(a.tool) || EDICAO.has(a.tool) || a.tool === 'Write'
    // Leitura ou edição que falhou não é trabalho feito: conta à parte.
    if (mexeArquivo && a.erro) falhasArquivo += 1
    else if (LEITURA.has(a.tool)) lidos.push(arquivo)
    else if (BUSCA.has(a.tool)) buscas += 1
    else if (EDICAO.has(a.tool) || a.tool === 'Write') {
      const antes = editados.get(caminho) ?? { nome: arquivo, mais: 0, menos: 0, criado: false }
      const d = diff(a.tool, a.input)
      editados.set(caminho, { ...antes, mais: antes.mais + d.mais, menos: antes.menos + d.menos, criado: antes.criado || a.tool === 'Write' })
    } else if (COMANDO.has(a.tool)) {
      const alvo = ehTeste(texto(c.command)) ? testes : comandos
      alvo.total += 1
      if (a.erro) alvo.falhas += 1
    } else if (a.tool === 'Agent' || a.tool === 'Task') delegados.push(texto(c.description) || 'subagente')
    else if (WEB.has(a.tool)) web += 1
    else {
      const nome = a.tool === 'Skill' ? `a skill ${texto(c.skill)}` : a.tool.startsWith('mcp__') ? servidorMcp(a.tool) : a.tool
      outros.set(nome, (outros.get(nome) ?? 0) + 1)
    }
  }

  const topicos: string[] = []
  if (lidos.length > 0) topicos.push(`Leu ${plural(lidos.length, 'arquivo', 'arquivos')} (${listaNomes(lidos)})`)
  if (buscas > 0) topicos.push(`Buscou ${plural(buscas, 'vez', 'vezes')} no projeto`)
  if (editados.size > 0) {
    const partes = [...editados.values()].map(d => (d.criado && d.menos === 0 ? `criou ${d.nome}` : `${d.nome} (+${d.mais} −${d.menos})`))
    topicos.push(`Editou ${partes.slice(0, 3).join(', ')}${partes.length > 3 ? ` e mais ${partes.length - 3}` : ''}`)
  }
  if (falhasArquivo > 0) topicos.push(`${plural(falhasArquivo, 'leitura/edição falhou', 'leituras/edições falharam')}`)
  if (testes.total > 0) topicos.push(testes.falhas === 0 ? 'Rodou os testes ✓' : `Rodou os testes ✗ (${plural(testes.falhas, 'falha', 'falhas')})`)
  if (comandos.total > 0) {
    topicos.push(`Rodou ${plural(comandos.total, 'comando', 'comandos')}${comandos.falhas > 0 ? ` · ${comandos.falhas} ${comandos.falhas === 1 ? 'falhou' : 'falharam'}` : ''}`)
  }
  if (delegados.length > 0) topicos.push(`Delegou ${plural(delegados.length, 'agente', 'agentes')} (${listaNomes(delegados, 2)})`)
  if (web > 0) topicos.push(`Consultou a web ${plural(web, 'vez', 'vezes')}`)
  for (const [nome, n] of outros) topicos.push(`Usou ${nome}${n > 1 ? ` ${n}×` : ''}`)
  return topicos
}
