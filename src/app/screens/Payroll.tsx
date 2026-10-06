import { Fragment, useState } from 'react'
import type { Engine, Actor } from '../../core/engine'
import { formatINR } from '../format'
import { payrollVm } from '../viewmodels'
import { Icon } from '../icons'

/** The staff model's role codes (DOCTOR, NURSE) as words. */
function titleCase(code: string): string {
  const lower = code.toLowerCase()
  return lower === 'admin' ? 'Administrator' : lower.charAt(0).toUpperCase() + lower.slice(1)
}

export default function Payroll({ engine, actor }: { engine: Engine; actor: Actor }) {
  const [openId, setOpenId] = useState<number | null>(null)

  // The router keeps other roles out; this guard keeps pay data safe if it ever renders anyway.
  if (actor.role !== 'ADMIN') return null

  const vm = payrollVm(engine)

  return (
    <section className="page" aria-labelledby="staff-title">
      <header className="page-head">
        <h1 id="staff-title">Staff and pay</h1>
        <p>
          This month’s pay for everyone on the roster. Each kind of staff member has its own pay rules (a doctor’s
          specialty allowance, a nurse’s ICU and night-shift pay, and so on). Open a row to see the rule-by-rule
          breakdown.
        </p>
      </header>

      {vm.rows.length === 0 ? (
        <p className="empty">No staff on the roster.</p>
      ) : (
        <div className="table-wrap">
          <table className="ledger ledger--staff">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Department</th>
                <th scope="col" className="ledger__num">
                  This month
                </th>
              </tr>
            </thead>
            <tbody>
              {vm.rows.map((row) => {
                const open = openId === row.member.id
                return (
                  <Fragment key={row.member.id}>
                    <tr className={open ? 'is-open' : undefined} onClick={() => setOpenId(open ? null : row.member.id)}>
                      <td>
                        <button
                          type="button"
                          className="ledger__who ledger__who--expand"
                          aria-expanded={open}
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpenId(open ? null : row.member.id)
                          }}
                        >
                          <Icon name="chevron" size={16} className="ledger__chev" />
                          <strong>{row.member.name}</strong>
                        </button>
                      </td>
                      <td>{titleCase(row.roleLabel)}</td>
                      <td>{row.member.department}</td>
                      <td className="ledger__num num">{formatINR(row.monthlyPaise)}</td>
                    </tr>
                    {open && (
                      <tr className="ledger__detail">
                        <td colSpan={4}>
                          <dl className="paylines">
                            {row.breakdown.map((line, i) => (
                              <div key={i}>
                                <dt>{line.label}</dt>
                                <dd className="num">{formatINR(line.amountPaise)}</dd>
                              </div>
                            ))}
                            <div className="paylines__total">
                              <dt>Total</dt>
                              <dd className="num">{formatINR(row.monthlyPaise)}</dd>
                            </div>
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  Everyone, this month
                </th>
                <td className="ledger__num num">{formatINR(vm.totalPaise)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}
