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
      <h2>Payroll</h2>
      {vm.rows.length === 0 ? (
        <p>No staff on record.</p>
      ) : (
        <table className="payroll-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Department</th>
              <th>Base</th>
              <th>Monthly pay</th>
            </tr>
          </thead>
          <tbody>
            {vm.rows.map((row) => (
              <Fragment key={row.member.id}>
                <tr
                  className="payroll-row"
                  onClick={() => setExpandedId((id) => (id === row.member.id ? null : row.member.id))}
                >
                  <td>{row.member.name}</td>
                  <td>{row.roleLabel}</td>
                  <td>{row.member.department}</td>
                  <td>{formatINR(row.member.basePaise)}</td>
                  <td>{formatINR(row.monthlyPaise)}</td>
                </tr>
                {expandedId === row.member.id && (
                  <tr className="payroll-breakdown-row">
                    <td colSpan={5}>
                      <ul className="payroll-breakdown">
                        {row.breakdown.map((line, i) => (
                          <li key={i}>
                            {line.label}: {formatINR(line.amountPaise)}
                          </li>
                        ))}
                        <li className="payroll-breakdown-sum">Total: {formatINR(row.monthlyPaise)}</li>
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
              <td>{formatINR(vm.totalPaise)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  )
}
