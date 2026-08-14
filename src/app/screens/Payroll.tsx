import { Fragment, useState } from 'react'
import type { Engine, Actor } from '../../core/engine'
import { formatINR } from '../format'
import { payrollVm } from '../viewmodels'

export default function Payroll({ engine, actor }: { engine: Engine; actor: Actor }) {
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // Nav already hides this link for non-ADMIN roles; guard here too so a
  // stale/forced navigation can't render payroll data to the wrong role.
  if (actor.role !== 'ADMIN') {
    return <p className="access-denied">Payroll is restricted to administrators.</p>
  }

  const vm = payrollVm(engine)

  return (
    <section className="payroll">
      {vm.rows.length === 0 ? (
        <p>No staff on record.</p>
      ) : (
        <div className="table-scroll">
          <table className="payroll-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Department</th>
                <th className="num">Base</th>
                <th className="num">Monthly pay</th>
              </tr>
            </thead>
            <tbody>
              {vm.rows.map((row) => (
                <Fragment key={row.member.id}>
                  <tr
                    className="payroll-row"
                    onClick={() => setExpandedId((id) => (id === row.member.id ? null : row.member.id))}
                  >
                    <td className="cell-strong">{row.member.name}</td>
                    <td>{row.roleLabel}</td>
                    <td>{row.member.department}</td>
                    <td className="num">{formatINR(row.member.basePaise)}</td>
                    <td className="num">{formatINR(row.monthlyPaise)}</td>
                  </tr>
                  {expandedId === row.member.id && (
                    <tr className="payroll-breakdown-row">
                      <td colSpan={5}>
                        <ul className="payroll-breakdown">
                          {row.breakdown.map((line, i) => (
                            <li key={i}>
                              <span>{line.label}</span>
                              <span className="num">{formatINR(line.amountPaise)}</span>
                            </li>
                          ))}
                          <li className="payroll-breakdown-sum">
                            <span>Total</span>
                            <span className="num">{formatINR(row.monthlyPaise)}</span>
                          </li>
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="payroll-total-row">
                <td colSpan={4}>Payroll total</td>
                <td className="num">{formatINR(vm.totalPaise)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}
