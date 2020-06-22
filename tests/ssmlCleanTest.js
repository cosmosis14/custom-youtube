function ssmlClean(inString) {
  let outString = inString.replace(/&/g, '&amp;')
  outString = outString.replace(/"/g, '&quot;')
  outString = outString.replace(/'/g, '&apos;')
  outString = outString.replace(/</g, '&lt;')
  outString = outString.replace(/>/g, '&gt;')

  return outString
}

const inString = 'quotation "marks" ampersand & apostrophe \' lessthan < greaterthan >'
console.log(inString)
console.log(ssmlClean(inString))