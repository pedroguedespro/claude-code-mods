import { expect, test } from 'claude-code/testing'

import { classificar, normalizar } from '../hooks/presets'

test('classifica a tarefa pela atividade', () => {
  expect(classificar('Roteirizar o vídeo do episódio 3')?.preset.id).toBe('video')
  expect(classificar('Pesquisar concorrentes no Instagram')?.preset.id).toBe('pesquisa')
  expect(classificar('Search the codebase for md files')?.preset.id).toBe('pesquisa')
  expect(classificar('Criar carrossel sobre tráfego pago')?.preset.id).toBe('copy')
  expect(classificar('Organizar notas do vault no Obsidian')?.preset.id).toBe('notas')
})

test('palavra inteira, sem acento, sem falso positivo dentro de outra palavra', () => {
  expect(classificar('EDIÇÃO do vídeo')?.preset.id).toBe('video')
  expect(classificar('postergar a decisão')?.preset.id).toBe('estrategia')
  expect(classificar('revisar o layout geral')).toBeNull()
})

test('empate entre (modelo, esforço) diferentes é ambíguo', () => {
  // vídeo (Opus/alto) x site (Opus/médio): 1 palavra cada
  expect(classificar('vídeo para o site')).toBeNull()
})

test('casos reais (sessão de 02/11): o título pesa mais e caminhos de arquivo não contam', () => {
  const pg = String.raw`C:\Users\ana\Desktop\Notas-OS`
  expect(
    classificar(
      'Resumir roteiro de vídeo',
      `Encontre um vídeo em ${pg} e procure o roteiro; busque a transcrição e resuma o hook em tópicos.`,
    )?.preset.id,
  ).toBe('video')
  expect(
    classificar('Top 3 maiores arquivos .md', `Liste os arquivos .md de ${pg}, encontre os 3 maiores e conte as linhas.`)
      ?.preset.id,
  ).toBe('pesquisa')
  // 2º teste de campo: título sem verbo de busca
  expect(classificar('Top 3 maiores arquivos .md', 'Get-ChildItem -Recurse -Filter *.md')?.preset.id).toBe('pesquisa')
  // arquivo + atividade concreta no título: empata entre modelos diferentes, então ambíguo (não força Haiku)
  expect(classificar('Editar arquivos do site')).toBeNull()
  // o caminho sozinho não puxa para Notas
  expect(classificar('Revisar o texto', String.raw`em ${pg}\notas\vault e ./src/obsidian/vault.ts`)).toBeNull()
  expect(normalizar(String.raw`ler C:\Users\ana\Desktop\Notas-OS\x.md agora`)).toBe(' ler agora ')
  // uma palavra do título vence qualquer quantidade no detalhe
  expect(classificar('Roteiro do episódio', 'buscar, listar, encontrar referências')?.preset.id).toBe('video')
})
