import { describe, it, expect } from 'vitest'
import { svgToSafeNode } from './svg-node'

describe('svgToSafeNode', () => {
  it('returns the svg as a node of the page document', () => {
    const node = svgToSafeNode(
      '<svg xmlns="http://www.w3.org/2000/svg"><g><text>hi</text></g></svg>'
    )
    expect(node).not.toBeNull()
    expect(node!.ownerDocument).toBe(document)
    expect(node!.querySelector('text')?.textContent).toBe('hi')
  })

  it('strips everything that could run code', () => {
    const node = svgToSafeNode(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="x()">' +
        '<script>x()</script>' +
        '<a href="javascript:x()"><text onclick="x()">link</text></a>' +
        '<a xlink:href="JavaScript:x()">two</a>' +
        '<foreignObject><iframe src="javascript:x()"></iframe><div onmouseover="x()">label</div></foreignObject>' +
        '</svg>'
    )!
    expect(node.querySelector('script')).toBeNull()
    expect(node.querySelector('iframe')).toBeNull()
    expect(node.getAttribute('onload')).toBeNull()
    expect(node.querySelector('text')?.getAttribute('onclick')).toBeNull()
    expect(node.querySelector('div')?.getAttribute('onmouseover')).toBeNull()
    for (const a of node.querySelectorAll('a')) {
      expect(a.getAttribute('href')).toBeNull()
      expect(a.getAttribute('xlink:href')).toBeNull()
    }
    // The label itself survives: scrubbing removes what runs, not what shows.
    expect(node.querySelector('div')?.textContent).toBe('label')
  })

  it('keeps the style mermaid embeds, which is how a diagram gets its look', () => {
    const node = svgToSafeNode(
      '<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:red}</style></svg>'
    )!
    expect(node.querySelector('style')?.textContent).toBe('.a{fill:red}')
  })

  it('accepts the HTML-flavoured SVG mermaid produces, which XML rejects', () => {
    const node = svgToSafeNode(
      '<svg xmlns="http://www.w3.org/2000/svg" id="d"><foreignObject>' +
        '<div xmlns="http://www.w3.org/1999/xhtml"><p>a&nbsp;b<br>c</p></div>' +
        '</foreignObject><g class="node"><text>ok</text></g></svg>'
    )
    expect(node).not.toBeNull()
    expect(node!.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(node!.querySelector('text')?.textContent).toBe('ok')
    expect(node!.querySelector('p')?.textContent).toContain('a')
  })

  it('refuses markup with no svg in it', () => {
    expect(svgToSafeNode('<div>not svg</div>')).toBeNull()
    expect(svgToSafeNode('')).toBeNull()
  })
})
