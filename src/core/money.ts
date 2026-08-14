export type Paise = number

export function paise(n: number): Paise {
  if (!Number.isSafeInteger(n)) {
    throw new Error(`paise: expected safe integer, got ${n}`)
  }
  return n
}

export function rupees(r: number): Paise {
  if (!Number.isSafeInteger(r)) {
    throw new Error(`rupees: ${r} is not an integer`)
  }
  const p = r * 100
  if (!Number.isSafeInteger(p)) {
    throw new Error(`rupees: ${r} rupees would result in non-integer paise`)
  }
  return p
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
  const rupees = Math.floor(abs / 100)
  const paise = abs % 100

  // Format the rupee part with Indian grouping
  const rupeesStr = formatIndianNumber(rupees)

  // Format the complete amount
  const formattedAmount = `${rupeesStr}.${String(paise).padStart(2, '0')}`

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
