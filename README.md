# PR #452 visual evidence

Captured from implementation commit c5b6a16334a50207d52fa7a96237c26509fd4720.

The maintained AgentChat browser fixture renders the actual Chat and shared History message components with synthetic user and agent messages. The capture pauses the fixture after its initial render, uses the real setChatTextScale(150) setter, and sizes its container to the viewport (maximum panel width 1100px). The caption identifies the configured 150% / 19.5px size. Application source and CSS are unmodified.

Chrome viewport sizes: phone 390x844 (touch emulation), laptop 1512x982, half-width 1280x1440, wide 2560x1440, portrait 1440x2560, all at device scale factor 1. The capture page includes the device-width viewport declaration. All five assert exact innerWidth/innerHeight, 19.5px computed fonts on user prose, assistant prose and bold Markdown, and no horizontal page overflow. Both roles are visible together. Each PNG was visually inspected; all content is synthetic.

These are component captures, not full World shell or native phone keyboard acceptance. Existing six browser suites and the passed check:changed gate remain the behavioral verification for the unchanged implementation head.
