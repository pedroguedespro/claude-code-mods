import type { PresetsClassificacao, PresetsEsforco, PresetsItem, PresetsModelo } from '../types'

export type Preset = PresetsItem
export type Esforco = PresetsEsforco

// Para mudar um preset, edite aqui e rode /reload-plugins.
// `palavras` decide a atividade de um subagente pela descrição da tarefa (mod time-agentes).
export const PRESETS: Preset[] = [
  {
    id: 'video', nome: 'Vídeo', uso: 'Roteiro, edição, cortes, HyperFrames', modelo: 'opus', esforco: 'high',
    palavras: ['video', 'videos', 'roteiro', 'roteirizar', 'edicao', 'editar video', 'corte', 'cortes', 'reels', 'shorts', 'hyperframes', 'thumbnail', 'screenplay', 'footage', 'clip', 'clips'],
  },
  {
    id: 'site', nome: 'Site/código', uso: 'Landing pages, sites, apps, mods', modelo: 'opus', esforco: 'medium',
    palavras: ['site', 'website', 'landing', 'landing page', 'pagina', 'html', 'css', 'frontend', 'componente', 'component', 'hostinger', 'deploy', 'mod', 'mods', 'refatorar', 'refactor', 'implementar', 'implement', 'bug', 'fix'],
  },
  {
    id: 'automacao', nome: 'Automação', uso: 'Scripts, integrações, ClickUp/Notion, rotinas', modelo: 'sonnet', esforco: 'medium',
    palavras: ['script', 'scripts', 'automacao', 'automatizar', 'automation', 'automate', 'integracao', 'integrar', 'integration', 'api', 'webhook', 'cron', 'rotina', 'clickup', 'notion'],
  },
  {
    id: 'pesquisa', nome: 'Pesquisa/rápido', uso: 'Perguntas rápidas, buscas, resumos', modelo: 'haiku', esforco: 'low',
    palavras: [
      'pesquisar', 'pesquisa', 'buscar', 'busca', 'procurar', 'listar', 'liste', 'lista', 'encontrar', 'localizar', 'resumir', 'resumo', 'explorar',
      'arquivo', 'arquivos', 'maior', 'maiores', 'menor', 'menores', 'tamanho', 'contar', 'quantos', 'quantas', 'top',
      'search', 'find', 'list', 'locate', 'explore', 'summarize', 'research', 'look up', 'files', 'largest', 'biggest', 'size', 'count',
    ],
  },
  {
    id: 'copy', nome: 'Copy', uso: 'Carrossel, posts, anúncios do dia a dia', modelo: 'sonnet', esforco: 'high',
    palavras: ['copy', 'carrossel', 'carousel', 'post', 'posts', 'anuncio', 'anuncios', 'headline', 'caption', 'legenda de post'],
  },
  {
    // Sem palavras: só entra por /modo, para não disputar com "copy".
    id: 'copy-premium', nome: 'Copy premium', uso: 'Lançamentos, páginas de venda, textos-chave', modelo: 'opus', esforco: 'medium',
    palavras: [],
  },
  {
    id: 'trafego', nome: 'Tráfego/ads', uso: 'Meta Ads, Google Ads, GA4, relatórios', modelo: 'sonnet', esforco: 'high',
    palavras: ['trafego', 'meta ads', 'google ads', 'campanha', 'campanhas', 'campaign', 'ga4', 'cpc', 'roas', 'ctr', 'criativo', 'criativos'],
  },
  {
    id: 'notas', nome: 'Notas', uso: 'Organizar notas, segundo cérebro, Obsidian, NotebookLM', modelo: 'haiku', esforco: 'medium',
    palavras: ['nota', 'notas', 'note', 'notes', 'vault', 'obsidian', 'segundo cerebro', 'second brain', 'notebooklm'],
  },
  {
    id: 'estrategia', nome: 'Estratégia', uso: 'Planos, arquitetura, decisões grandes', modelo: 'opus', esforco: 'xhigh',
    palavras: ['plano', 'planejar', 'estrategia', 'strategy', 'arquitetura', 'architecture', 'decisao', 'decidir', 'plan review', 'revisar plano'],
  },
]

export const NOME_ESFORCO: Record<Esforco, string> = {
  low: 'baixo',
  medium: 'médio',
  high: 'alto',
  xhigh: 'muito alto',
  max: 'máximo',
}

export const NOME_MODELO: Record<PresetsModelo, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
}

export function rotulo(p: Preset): string {
  return `${p.nome}: ${NOME_MODELO[p.modelo]} · ${NOME_ESFORCO[p.esforco]}`
}

export function acharPreset(texto: string): Preset | undefined {
  const t = texto.trim().toLowerCase()
  return PRESETS.find(p => p.id === t || p.nome.toLowerCase() === t)
}

// Minúsculas, sem acento, sem caminhos de arquivo (C:\...\Projeto, ./src/x.ts), só letras/números separados por um espaço.
export function normalizar(texto: string): string {
  return ` ${texto
    .replace(/\S*[\\/]\S*/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, ' ')
    .trim()} `
}

// Pontua cada preset pelas palavras-chave: o título manda (cada palavra nele vale 100) e o detalhe
// só desempata ou decide quando o título não tem pista. Empate no topo entre (modelo, esforço)
// diferentes = ambíguo (null).
export function classificar(titulo: string, detalhe = ''): PresetsClassificacao | null {
  const t = normalizar(titulo)
  const d = normalizar(detalhe)
  let melhor = 0
  let vencedores: PresetsClassificacao[] = []
  for (const preset of PRESETS) {
    const acertos = preset.palavras.filter(p => t.includes(normalizar(p)) || d.includes(normalizar(p)))
    const pontos = acertos.reduce((soma, p) => soma + (t.includes(normalizar(p)) ? 100 : 1), 0)
    if (pontos === 0 || pontos < melhor) continue
    if (pontos > melhor) {
      melhor = pontos
      vencedores = []
    }
    vencedores.push({ preset, acertos })
  }
  const primeiro = vencedores[0]
  if (!primeiro) return null
  const pares = new Set(vencedores.map(v => `${v.preset.modelo}/${v.preset.esforco}`))
  return pares.size === 1 ? primeiro : null
}
