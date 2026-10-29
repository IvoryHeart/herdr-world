### Changed

- Scope PR checks to affected tests, contracts and platform inputs, while keeping
  the complete CI matrix on main and for unknown changes.
- Split long test and model jobs across runners, retain isolated latency checks,
  and expose leaf failures before the protected delivery aggregate completes.
