import 'regenerator-runtime/runtime'
import fileReaderStream from 'filereader-stream'
import subsrt from 'subsrt'
import difflib from 'difflib'
import crypto from 'crypto'
const { SubtitleParser } = require('matroska-subtitles')
import { toJpeg } from 'html-to-image';

document.getElementById('jpgexport').addEventListener('click', e => {
  toJpeg(document.getElementById('diff'), { quality: 0.95 })
  .then(function (dataUrl) {
    var link = document.createElement('a');
    link.download = 'evadiff.jpg';
    link.href = dataUrl;
    link.click();
  });
})

const input = document.querySelector('input')
const droparea = document.querySelector('.file-drop-area')
const statusEl = document.querySelector('.file-msg')
const statusInit = statusEl.textContent
const diffFiles = {}
const diffOptions = { fileA: null, fileB: null, fileAExcludedStyles: [], fileBExcludedStyles: [], fileAReplace: {}, fileBReplace: {}, sortByTime: false, stripTags: true, removeEmptyLines: true, normalizeWhitespace: true, normalizeCharacters: true, removePosLines: true, removeDrawLines: true, mergeDuplicateLines: true, mergeAlphaTiming: false, removeSpecialCharacters: false, ignorePunctuation: false, ignoreHonorifics: false, removeHonorifics: false, lowerCase: false, diffMatching: 'words', diffOutputFormat: 'side-by-side' }
const checkboxOptions = { /*sortByTime: 'Sort by time',*/ stripTags: 'Strip tags', removeEmptyLines: 'Remove empty lines', normalizeWhitespace: 'Normalize whitespace', normalizeCharacters: 'Normalize characters', removePosLines: 'Remove \\pos lines', removeDrawLines: 'Remove \\p (drawing) lines', mergeDuplicateLines: 'Merge duplicate lines', mergeAlphaTiming: 'Merge alpha timing', removeSpecialCharacters: 'Remove special characters', removeHonorifics: 'Remove honorifics', lowerCase: 'Convert to lowercase' }

const opts = document.getElementById('globalopt')
for (const option in checkboxOptions) {
  const label = document.createElement('label')
  label.htmlFor = 'chk-'+option
  label.textContent = checkboxOptions[option]
  label.classList.add('fileinfo')
  const opt = document.createElement('div')
  opt.id = 'opt-'+option
  opt.classList.add('option')
  const chk = document.createElement('input')
  chk.id = 'chk-'+option
  chk.type = 'checkbox'
  chk.checked = diffOptions[option]
  label.appendChild(opt)
  opt.appendChild(chk)
  chk.addEventListener('change', ck => {
    diffOptions[option] = ck.target.checked
    diffUpdate()
  })
  opts.appendChild(label)
}

function clearStatus() {
  statusEl.textContent = statusInit
}

function handleLines(data, options) {
  const lines = []
  const styles = new Set()
  // TODO: sortByTime
  data.forEach(line => {
    if (line.type != 'caption') return

    if (line.data && line.data.Style && options.excludedStyles.includes(line.data.Style) && !line.content.includes('{')) return
    if (options.removePosLines && /\{[^\}]*\\pos/.test(line.content)) return
    if (options.removeDrawLines && /\{[^\}]*\\p[0-9 .-\\\}]/.test(line.content)) return

    let text = options.stripTags ? line.text : line.content

    if (options.excludedStyles.length > 0 && line.content.includes('{')) {
      const matches = [...line.content.matchAll(/\{[^\}]*\\r([^\\\}]*)[^\}]*\}/g)]
      if (matches.length > 0) {
        matches.unshift('')
        const sp = line.content.split(/\{[^\}]*\\r[^\\\}]*[^\}]*\}/g) // TODO: optimize by slicing strings with s.index and length of s[1], we don't need the .split()
        let newText = ''
        matches.forEach((s, i) => {
          if (i == 0) {
            newText += sp[i]
            return
          }
          let effectiveStyle = s[1]
          if (line.data && line.data.Style && effectiveStyle === '') effectiveStyle = line.data.Style
          if (!options.excludedStyles.includes(effectiveStyle)) {
            newText += s[0]
            newText += sp[i]
          }
        })
        if (options.stripTags) {
          newText = text.replace(/\{[^\}]*\\p(?:0+[1-9]|[1-9]{1}\d{0,3})[^\}]*\}.*?\{[^\}]*\\p0.*?(?<!\\p1)\}|\{[^\}]*\\p(?:0+[1-9]|[1-9]{1}\d{0,3}).*$/g, '').replace(/\{[^\}]*\}/g, '').replace(/\\h/g, ' ').replace(/\s?\\n\s?/g, ' ').replace(/\s?\\N\s?/g, '\r\n');
        }
        // TODO: if VTT or SRT, decode HTML entities
        text = newText
      }
    }

    if (options.removeEmptyLines && text.replace(/\xa0/g, ' ').trim() === '') return

    if (options.normalizeCharacters) {
      text = text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/…/g, '...')
    }

    if (options.removeSpecialCharacters) {
      text = text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()…?–—]/g, '')
    }

    if (options.removeHonorifics) {
      text = text.replace(/\b-(?:san|sama|kun|chan|tan|senpai|sensei|kohai|hakase|neechan|oneesan|oneesama|oneechan|onichan|onisan|obasan|oobasan|neesan|aneki|aniki|zeki|han|niichan|dono|ojosama|niisan|oniisama|ojisan|nee|nii)\b/gi, '')
    }

    if (options.normalizeWhitespace) {
      text = text.replace(/\xa0/g, ' ').replace(/\s+/g, ' ').trim()
    }

    for (const rep in options.replace) {
      // TODO: allow regex?
      text = text.replace(rep, options.replace[rep])
    }

    if (options.lowerCase) {
      text = text.toLowerCase()
    }

    if (lines[lines.length - 1] == text) {
      if (options.mergeDuplicateLines) return
    } else if (options.mergeAlphaTiming && text.startsWith(lines[lines.length - 1])) {
      lines[lines.length - 1] = text
      return
    }

    lines.push(text)

    if (line.data && line.data.Style) {
      styles.add(line.data.Style)
    }
  })
  return { lines: lines, styles: styles }
}

function guessGroup(filename) {
  const discordStyle = filename.match(/^([A-Za-z0-9-]+)_[A-Za-z_]+_-_(?:[Ss]\d+)?[Ee]?\d+[_.]/)
  if (discordStyle) return discordStyle[1]

  const groupBlacklist = ['xvid', 'x264', 'x265', 'avc', 'hevc', 'dvd', 'dvd5', 'dvd9', 'dvdiso', 'dvd-r', 'dvdr', 'movie', '4k', '2160p', '1080p', '720p', '576p', '480p', '2160', '1080', '720', '576', '480', 'bluray', 'bdmv', 'bdiso', 'proper', 'aac', 'ac3', 'flac', 'vob', 'ifo', 'vob ifo', 'vob.ifo', 'vob_ifo', 'avi', 'remux', 'uncut', 'dl', 'us', 'r', 'j', 'jp', 'jpn', 'ita', 'dvdrip', 'pal', 'ntsc', 'bd', 'bdremux', 'bdremux.1080p', '1080p remux', 'hd', 'eng', 'exclusive', 'japanese', 'nogrp', 'nogroup', '3d half sbs', 'r1', 'r2', 'r2j', 'extras', 'trailers', 'rifftrax', 'cd1', 'cd2'];
  const groupRegex = /^\[(?!Japanese)(?:[0-9]+[pP]?|MOVIE|DVD(?:[95]|ISO|-?R)?|BDMV|([^[\u4E00-\u9FCC¶^\]]+))\](?!\[).*|^\[(?!Japanese)(?:MOVIE|DVD(?:[95]|ISO|-?R)?|BDMV|\d{6}|([^½ \]\u4E00-\u9FCC]+))\].*|.*[a-zA-Z .\]]\[(?:.* Edition|[rR]iff[tT]rax|REMUX|PROPER|MOVIE|DVD(?:[95]|ISO|R).*|BD(?:MV|\d+)|AC3|AAC|.* DVD|[0-9]+[pP]?|.*?26[45]+.*?|[a-f0-9]{8}|[A-F0-9]{8}|.*FLAC|R2[ JFD].*|([^[)+-]+))](?:\[[0-9]+[pP]])$|.*(?:\.|[xhXH]\.?26[45] )(?:REMUX|PROPER|MOVIE|DVD(?:[95]|ISO|-?R)?|BD(?:MV|\d+)|AC3|AAC|FLAC|PAL|NTSC|XVID|DTS|DUB|[xhXH]\.?26[45]|(?![cC][dD]\d|BLURAY)([A-Z]-)?([A-Z][A-Zi0-9]+|[A-Z][a-z][A-Z]|@[a-zA-Z]{2,}))$|^(lazers|neroz)-[a-z0-9-]+$|^([a-z]{3,4}|refined|publichd)(?:-[a-z0-9-]*|(?:\.EXTRAS)?\.[a-z0-9.]*)\.?(?:2160|1080|720|480)p?$|.*(?:WEB-DL|10-bit|(?:_-_|(?:[ \d]- )(?!DTS-))(?:\d+|[0-9]+[pP]?|PROPER|OU|J(?:PN?)?|US|R|WB|[xhXH]\.?26[45]|[aA][vV][iI]|Uncut|Untouched|DVDRIP|Extras|Trailers|Copy|[rR]iff[tT]rax|[a-z]*1080p|[([]?\d+|[bB][iI]|[cC][dD]\d|([^ .\])_~]+)))\)?$|.*(?:WEB-DL|10-bit|(?:_-_|(?:-([A-Z][A-Z0-9]-)|...-))(?:\d+|[0-9]+[pP]?|PROPER|OU|J(?:PN?)?|US|R|[xhXH]\.?26[45]|Uncut|Untouched|[a-z]*1080p|.*_3D_([A-Z]{4,})$|.*DVD(?:[95]|ISO|-?R)?|[bB][iI]|Live_In_.*|([^ .\])]+)))-Exclusive\)?$|.*(?:[bB]lu-[rR]ay|WEB-DL|10-bit|(?:_-_|(?:S-([A-WYZ][A-Z0-9]?-)|[^S]-([A-Z][A-Z0-9]?-)|(FTW-)|.(?!BD-[JKR][)\]]?$).(?!3-D$).-))(?:\d+|[0-9]+[pP]?|PROPER|OU|J(?:PN?)?|US|R|X|[xhXH]\.?26[45]|Uncut|Untouched|[mM]ovie|[a-z]*1080p|.*_3D_([A-Z]{4,})$|.*DVD(?:[95]|ISO|-?R)?|[bB][iI]|Live_In_.*|\[([A-Z]+|[a-z]+)]|((?:[A-Z]\.?)+|[^ .\])]+(?:\[\d+])?)))\)?$|.*(?:[bB]lu-[rR]ay|WEB-DL|10-bit|(?:_-_|(?:S-([A-WYZ][A-Z0-9]?-)|[^S]-([A-Z][A-Z0-9]?-)|(FTW-)|.(?!BD-[JKR][)\]]?$).(?!3-D$).-|~))(?:\d+|[0-9]+[pP]?|PROPER|OU|J(?:PN?)?|US|R|X|[xhXH]\.?26[45]|Uncut|Untouched|[mM]ovie|[a-z]*1080p|.*_3D_([A-Z]{4,})$|.*DVD(?:[95]|ISO|-?R)?|[bB][iI]|Live_In_.*|\[([A-Z]+|[a-z]+)]|((?:[A-Z]\.?)+|[^ .\])]+(?:\[\d+])?)))\)?$|^[a-z]{3}_\[(?:[0-9]+[pP]?|MOVIE|DVD(?:[95]|ISO|-?R)?|BDMV|([^[\u4E00-\u9FCC]+))\]|^([a-z]{2,3})\..*|.*?(?:\[((?:[A-Z]{3}-)?[A-Z][a-z]{3,})\]) ?\[(?:[a-f0-9]{8}|[A-F0-9]{8})]$|(?!DVD-R).*[a-zA-Z .\]]\[(?:.* Edition|[rR]iff[tT]rax|REMUX|PROPER|MOVIE|PAL|(?:PAL.)?DVD(?:[95]|ISO|R).*|BD(?:MV|\d+)|AC3|AAC|.* DVD|[0-9]+[pP]?|.*?26[45]+.*?|[a-f0-9]{8}|[A-F0-9]{8}|.*FLAC|Eng|Ita|R\d(?:J|FR)?|.*DVD\.XviD|VOB.IFO|R2[ JFD].*|EXTRAS.*|\d+p [rR]emux|.*, \d{4}|([^[)+-]+))]$|^([a-z]+)-.*(?:[0-9]+[pP]?$)|^[a-z]{2}-([a-z]{3})$|^(?:[A-Z_]|3D)+_(?:REMUX|BLURAY|([A-Zi]{2,4}HD|HD[A-Z]{4}))$|.*\d\.\d ([a-z]{4}|[A-Z][a-z]+[A-Z]+)$|.*\.\d{4}\.BDrip\.([A-Z][a-z]+[A-Z][a-z]+)$|.*(?:-AC3|\.[xX][vV][iI][dD]|\.dxva)\.([a-z0-9]+|[A-Zi0-9]+|[A-Z][a-z]+[A-Z])$|.+/g;
  const groupName = filename.replace(/\.[^/.]+$/, '').trim().replace('DTS-HD-', '-').replace(groupRegex, '$1$2$3$4$5$6$7$8$9$10$11$12$13$14$15$16$17$18$19$20$21$22$23$24$25$26$27$28$29$30$31$32$33')
  return (groupName && groupName.length > 0 && !groupBlacklist.includes(groupName.toLowerCase())) ? groupName : filename
}

function fileList() {
  const flist = document.getElementById('filelist')
  for (const hash in diffFiles) {
    if (document.getElementById('file-' + hash)) continue
    const info = document.createElement('div')
    info.id = 'file-' + hash
    info.classList.add('fileinfo')
    if (hash == diffOptions.fileA || hash == diffOptions.fileB) info.classList.add('is-active')
    info.textContent = diffFiles[hash].title + ' (' + diffFiles[hash].format + ')' + '\n' + diffFiles[hash].filename
    info.innerHTML = info.innerHTML.replace('\n', '<br>')
    flist.appendChild(info)
    info.addEventListener('click', e => {
      if (info.classList.contains('is-active')) {
        if (hash == diffOptions.fileA) {
          diffOptions.fileA = null
        } else {
          diffOptions.fileB = null
        }
        info.classList.remove('is-active')
        diffUpdate()
      } else {
        if (diffOptions.fileA == null) {
          diffOptions.fileA = hash
          info.classList.add('is-active')
          if (diffOptions.fileB != null) {
            diffUpdate()
          }
        } else if (diffOptions.fileB == null) {
          diffOptions.fileB = hash
          info.classList.add('is-active')
          if (diffOptions.fileA != null) {
            diffUpdate()
          }
        } else {
          console.log("Can't select more than two files!") // TODO: toast or flashing animation to indicate this
        }
      }
    })
  }
}

function diffUpdate() {
  if (!diffOptions.fileA || !diffOptions.fileB) {
    document.getElementById('diff').innerHTML = ''
    document.getElementById('afterdiff').style.display = 'none'
    return
  }
  const dataA = handleLines(diffFiles[diffOptions.fileA].data, {excludedStyles: diffOptions.fileAExcludedStyles, replace: diffOptions.fileAReplace, ...diffOptions})
  const dataB = handleLines(diffFiles[diffOptions.fileB].data, {excludedStyles: diffOptions.fileBExcludedStyles, replace: diffOptions.fileBReplace, ...diffOptions})
  // TODO: display styles that can be excluded, dataA.styles, dataB.styles
  const titleA = diffFiles[diffOptions.fileA].title || diffFiles[diffOptions.fileA].filename || 'A'
  const titleB = diffFiles[diffOptions.fileB].title || diffFiles[diffOptions.fileB].filename || 'B'
  if (dataA.lines.length == 0) {
    document.getElementById('diff').textContent = 'File "' + titleA + '" is empty after filtering.'
    document.getElementById('afterdiff').style.display = 'none'
    return
  } else if (dataB.lines.length == 0) {
    document.getElementById('diff').textContent = 'File "' + titleB + '" is empty after filtering.'
    document.getElementById('afterdiff').style.display = 'none'
    return
  }
  const diff = difflib.unifiedDiff(dataA.lines, dataB.lines, {fromfile: titleA, tofile: titleB, lineterm: ''}).join('\n')
  if (diff.trim() === '') {
    document.getElementById('diff').textContent = 'No changes between ' + titleA + ' and ' + titleB + '.'
    document.getElementById('afterdiff').style.display = 'none'
    return
  }
  const diff2htmlUi = new Diff2HtmlUI(document.getElementById('diff'), diff, { matching: diffOptions.diffMatching, outputFormat: diffOptions.diffOutputFormat, drawFileList: false, fileContentToggle: false, highlight: false });
  diff2htmlUi.draw();
  document.querySelectorAll('.d2h-code-side-line, .d2h-code-line').forEach(line => {
    const oline = line.innerHTML
    let nline = oline
    if (diffOptions.ignorePunctuation) {
      nline = nline.replace(/<(?:del[^>]*|ins[^>]*)>([ .,\/#!$%\^&\*;:{}=\-_`'~()…?–—])<\/(?:del|ins)>/g, '$1')
    }
    if (diffOptions.ignoreHonorifics) {
      nline = nline.replace(/<(?:del[^>]*|ins[^>]*)>-(san|sama|kun|chan|tan|senpai|sensei|kohai|hakase|neechan|oneesan|oneesama|oneechan|onichan|onisan|obasan|oobasan|neesan|aneki|aniki|zeki|han|niichan|dono|ojosama|niisan|oniisama|ojisan|nee|nii)<\/(?:del|ins)>/g, '-$1')
    }
    nline = nline.replace(/<\/(?:del|ins)>([ .,\/#!$%\^&\*;:{}=\-_`'~()…?–—])<(?:del[^>]*|ins[^>]*)>/g, '$1').replace(/([ '])<\/(del|ins)>/g, '</$2>$1')
    if (nline != oline) line.innerHTML = nline
  })
  document.querySelectorAll('.d2h-file-side-diff:first-child .d2h-diff-tbody > tr .d2h-code-side-linenumber, .d2h-file-diff .d2h-diff-tbody > tr .d2h-code-linenumber').forEach(lineNumber => {
    lineNumber.addEventListener('click', e => {
      const line = Array.from(lineNumber.parentNode.parentNode.children).indexOf(lineNumber.parentNode)
      if (e.shiftKey) {
        const selCur = document.querySelectorAll('.d2h-file-side-diff:first-child tr.highlight, .d2h-file-diff tr.highlight')
        const selStart = selCur[0]
        if (selStart) {
          const selEnd = selCur[selCur.length - 1]
          const selStartI = Array.from(selStart.parentNode.children).indexOf(selStart)
          const selEndI = Array.from(selEnd.parentNode.children).indexOf(selEnd)
          Array.from(document.querySelector('.d2h-file-side-diff:first-child .d2h-diff-tbody, .d2h-file-diff .d2h-diff-tbody').children).slice(Math.min(line, selStartI), Math.max(line, selEndI)+1).forEach(sel => sel.classList.add('highlight'))
          if (diffOptions.diffOutputFormat === 'side-by-side') {
            Array.from(document.querySelector('.d2h-file-side-diff:last-child .d2h-diff-tbody').children).slice(Math.min(line, selStartI), Math.max(line, selEndI)+1).forEach(sel => sel.classList.add('highlight'))
          }
        }
      } else {
        const highlights = document.querySelectorAll('.d2h-diff-tbody > tr.highlight')
        highlights.forEach(l => l.classList.remove('highlight'))
        if (highlights.length === (diffOptions.diffOutputFormat === 'side-by-side' ? 2 : 1) && highlights[0] == e.target.parentNode) return
      }
      lineNumber.parentNode.classList.add('highlight')
      if (diffOptions.diffOutputFormat === 'side-by-side') {
        document.querySelector('.d2h-file-side-diff:last-child .d2h-diff-tbody').children[line].classList.add('highlight')
      }
    })
  })
  document.querySelectorAll('.d2h-file-side-diff:last-child .d2h-diff-tbody > tr .d2h-code-side-linenumber').forEach(lineNumber => {
    lineNumber.addEventListener('click', e => {
      const line = Array.from(lineNumber.parentNode.parentNode.children).indexOf(lineNumber.parentNode)
      if (e.shiftKey) {
        const selCur = document.querySelectorAll('.d2h-file-side-diff:first-child tr.highlight')
        const selStart = selCur[0]
        if (selStart) {
          const selEnd = selCur[selCur.length - 1]
          const selStartI = Array.from(selStart.parentNode.children).indexOf(selStart)
          const selEndI = Array.from(selEnd.parentNode.children).indexOf(selEnd)
          Array.from(document.querySelector('.d2h-file-side-diff:first-child .d2h-diff-tbody').children).slice(Math.min(line, selStartI), Math.max(line, selEndI)+1).forEach(sel => sel.classList.add('highlight'))
          Array.from(document.querySelector('.d2h-file-side-diff:last-child .d2h-diff-tbody').children).slice(Math.min(line, selStartI), Math.max(line, selEndI)+1).forEach(sel => sel.classList.add('highlight'))
        }
      } else {
        const highlights = document.querySelectorAll('.d2h-diff-tbody > tr.highlight')
        highlights.forEach(l => l.classList.remove('highlight'))
        if (highlights.length === (diffOptions.diffOutputFormat === 'side-by-side' ? 2 : 1) && highlights[highlights.length - 1] == e.target.parentNode) return
      }
      lineNumber.parentNode.classList.add('highlight')
      document.querySelector('.d2h-file-side-diff:first-child .d2h-diff-tbody').children[line].classList.add('highlight')
    })
  })
  document.querySelectorAll('.d2h-ins:not(.d2h-change) .d2h-code-line-ctn').forEach(emptyLine => {
    emptyLine.innerHTML = '<ins>' + emptyLine.innerHTML + '</ins>'
  })
  document.querySelectorAll('.d2h-del:not(.d2h-change) .d2h-code-line-ctn').forEach(emptyLine => {
    emptyLine.innerHTML = '<del>' + emptyLine.innerHTML + '</del>'
  })
  document.getElementById('afterdiff').style.display = 'block'
}

function addSubtitle(filename, index, data, format=null, title=null, name=null) {
  if (!title) title = guessGroup(filename)
  if (name === title) name = null
  if (name && name.includes(title) && name.includes('(')) {
    title = name
    name = null
  }

  // TODO: (specifically for clipboard) parse ASS title section

  const fileIndex = filename.match(/_(?:Track)?(\d+)\.[A-Za-z]{3}$/)
  const hash = crypto.createHash('sha1').update(data).digest('hex')

  if (diffFiles[hash]) return

  if (!format) format = subsrt.detect(data)

  const parsed = subsrt.parse(data, {format: format})

  if (parsed.length == 0) return

  diffFiles[hash] = {
    filename: filename,
    format: format,
    data: parsed,
    title: (index > 1 && Object.keys(diffFiles).some(f => diffFiles[f].title === (name ? title + ' (' + name + ')' : title)) && !name) ? title + '_' + index : (fileIndex && !name) ? title + '_' + parseInt(fileIndex[1]) : name ? title + ' (' + name + ')' : title
  }

  fileList()

  if (!diffOptions.fileA) {
    document.getElementById('file-'+hash).click()
  } else if (!diffOptions.fileB) {
    document.getElementById('file-'+hash).click()
  }
}

diffUpdate()

input.addEventListener('change', handleFiles)

document.addEventListener('paste', e => {
  const paste = (event.clipboardData || window.clipboardData).getData('text');
  if (paste.trim() === '') return

  addSubtitle('clipboard', 0, paste, null, 'Clipboard content')
})

const activeElements = ['dragenter', 'focus', 'click']
activeElements.forEach(event => input.addEventListener(event, handleDropActive))
function handleDropActive () {
  droparea.classList.add('is-active')
}

const inactiveEvents = ['dragleave', 'blur', 'drop']
inactiveEvents.forEach(event => input.addEventListener(event, handleDropInactive))
function handleDropInactive () {
  droparea.classList.remove('is-active')
}

async function handleFiles (event: Event) {
  const target = event.target as HTMLInputElement
  const files = target.files
  statusEl.textContent = `Loading ${files.length} ${files.length === 1 ? 'file' : 'files'}...`

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex]
    const filename = file.name
    const normalized = filename.toLowerCase()

    if (normalized.endsWith('.ass') || normalized.endsWith('.ssa') || normalized.endsWith('.srt') || normalized.endsWith('.vtt') || normalized.endsWith('.txt')) {
      addSubtitle(filename, 0, await file.text())
    } else if (normalized.endsWith('.mkv') || normalized.endsWith('.mks')) {
      const fileStream = fileReaderStream(file, {
        chunkSize: 2 * 1024 * 1024
      })
      try {
        const parser = new SubtitleParser()
        let stream = undefined
        handleSubtitleParser(parser, filename)
        const finish = () => {
          console.log('Sub parsing finished')
          fileStream?.destroy()
          stream?.destroy()
          stream = undefined
        }
        parser.once('tracks', tracks => {
          if (!tracks.length) finish()
        })
        parser.once('finish', finish)
        stream = fileStream.pipe(parser)
      } catch (error) {
        console.log(error)
      } finally {
      }
    }
  }

  statusEl.textContent = 'Loading...'
  setTimeout(clearStatus, 4000)
}


async function handleSubtitleParser (parser, filename) {
  const subs = {}

  const finish = () => {
    console.log('Sub parsing finished')

    if (subs.length == 0) return

    for (const index in subs) {
      if (subs[index].type === 'ass' || subs[index].type === 'ssa') {
        const header = subs[index].header.split(/(^\[Events\](?:\s+(?!\[).*)*\s*)/m)
        header.splice(2, 0, subs[index].data)
        subs[index].data = header.join('')
      }

      addSubtitle(filename, index, subs[index].data, subs[index].type === 'utf8' ? 'srt' : subs[index].type === 'webvtt' ? 'vtt' : subs[index].type, null, subs[index].name)
    }
  }

  parser.once('tracks', tracks => {
    if (!tracks.length) {
      parser?.destroy()
      finish()
    } else {
      tracks.forEach(track => {
        subs[track.number] = {type: track.type, count: 0, name: track.name, data: '', header: track.header}
      })
    }
  })

  parser.once('finish', finish)

  parser.on('subtitle', (subtitle, trackNumber) => {
    subs[trackNumber].count += 1
    if (subs[trackNumber].type == 'utf8' || subs[trackNumber].type == 'webvtt') {
      subs[trackNumber].data += '\r\n' + subs[trackNumber].count
    }
    subs[trackNumber].data += '\r\n' + subtitle.content
  })
}

function formatDuration (duration) {
  duration = Math.round(duration)
  if (duration < 2) return 'few seconds'
  if (duration < 58) return duration + ' seconds'
  if (duration < 120) return '1 minute'
  if (duration < 3598) return Math.floor(duration / 60) + ' minutes'
  if (duration < 7200) return '2 hours'
  return Math.floor(duration / 3600) + ' hours'
}
