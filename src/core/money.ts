export type Paise = number

export function paise(n: number): Paise {
  if (!Number.isSafeInteger(n)) {
    throw new Error(`paise: expected safe integer, got ${n}`)
  }
  return n
}

export function rupees(r: number): Paise {
  const p = r * 100
  const rounded = Math.round(p)
  if (Math.abs(p - rounded) > 1e-6) {
    throw new Error(`rupees: ${r} is not paise-precise`)
  }
  if (!Number.isSafeInteger(rounded)) {
    throw new Error(`rupees: ${r} rupees would result in non-integer paise`)
  }
  return rounded
}

export function addP(a: Paise, b: Paise): Paise {
  return a + b
}

export function subP(a: Paise, b: Paise): Paise {
  return a - b
}

export function mulP(a: Paise, n: number): Paise {
  if (!Number.isSafeInteger(n)) {
    throw new Error(`mulP: multiplier must be a safe integer, got ${n}`)
  }
  if (n < 0) {
    throw new Error(`mulP: multiplier must be non-negative, got ${n}`)
  }
  return a * n
}

export function sumP(xs: Paise[]): Paise {
  return xs.reduce((acc, x) => acc + x, 0)
}

export function formatINR(a: Paise): string {
  const isNegative = a < 0
  const abs = Math.abs(a)

  // Convert to rupees and paise
  const rupeePart = Math.floor(abs / 100)
  const paisePart = abs % 100

  // Format the rupee part with Indian grouping
  const rupeesStr = formatIndianNumber(rupeePart)

  // Format the complete amount
  const formattedAmount = `${rupeesStr}.${String(paisePart).padStart(2, '0')}`

  if (isNegative) {
    return `−₹${formattedAmount}` // U+2212 minus sign
  } else {
    return `₹${formattedAmount}`
  }
}

function formatIndianNumber(num: number): string {
  const str = String(num)

  if (str.length <= 3) {
    return str
  }

  // Indian grouping: last 3 digits, then groups of 2
  const lastThree = str.slice(-3)
  const remaining = str.slice(0, -3)

  const groups: string[] = []
  let current = remaining

  while (current.length > 2) {
    groups.unshift(current.slice(-2))
    current = current.slice(0, -2)
  }

  if (current.length > 0) {
    groups.unshift(current)
  }

  groups.push(lastThree)
  return groups.join(',')
}
