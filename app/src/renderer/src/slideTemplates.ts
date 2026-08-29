/** Starter templates for new *.slides.md decks (Phase 4.5). `---` starts a
 *  new slide, `--` a vertical child slide under the previous one. */

export interface SlideTemplate {
  id: string
  label: string
  hint: string
  content: string
}

export const SLIDE_TEMPLATES: SlideTemplate[] = [
  {
    id: 'pitch',
    label: 'Pitch',
    hint: 'Problem → solution → ask',
    content: [
      '# Project Name',
      '',
      'A one-line pitch.',
      '',
      '---',
      '',
      '## The Problem',
      '',
      '- Who hurts today',
      '- Why current options fall short',
      '',
      '---',
      '',
      '## The Solution',
      '',
      '- What it does',
      '- Why now',
      '',
      '--',
      '',
      '### How it works',
      '',
      '1. Step one',
      '2. Step two',
      '',
      '---',
      '',
      '## The Ask',
      '',
      '- What you need',
      '- What happens next',
      ''
    ].join('\n')
  },
  {
    id: 'tutorial',
    label: 'Tutorial',
    hint: 'Agenda → steps with code → recap',
    content: [
      '# Tutorial Title',
      '',
      'What you will learn.',
      '',
      '---',
      '',
      '## Agenda',
      '',
      '1. Setup',
      '2. First steps',
      '3. Recap',
      '',
      '---',
      '',
      '## Setup',
      '',
      '```bash',
      'npm install example',
      '```',
      '',
      '--',
      '',
      '### Details',
      '',
      'Vertical slides hold the deep dive.',
      '',
      '---',
      '',
      '## Recap',
      '',
      '- Key takeaway',
      ''
    ].join('\n')
  },
  {
    id: 'blank',
    label: 'Blank',
    hint: 'Just a title slide',
    content: ['# New Deck', '', '---', '', '## First Slide', ''].join('\n')
  }
]
