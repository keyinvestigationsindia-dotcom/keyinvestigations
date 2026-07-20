# Legal & Investigation Intelligence Engine — v1.0 Documentation

Official documentation for both **KEY Investigations** and the **Bima Anveshak AI Engine**. This is the frozen v1.0 reference — see [Architecture](architecture.md) for what "frozen" means and what's in/out of scope for this version.

## Start here

- **New to this feature?** Read [Architecture](architecture.md) first — the three-layer model, the shared contract, and the design principles everything else depends on.
- **Building or extending a module?** [Developer Guide](developer-guide.md) → [Module Documentation](module-documentation.md) → [Testing Guide](testing-guide.md).
- **Investigator or QC reviewer?** [User Manual](user-manual.md) — no technical background needed.
- **Deploying or troubleshooting infrastructure?** [Deployment Guide](deployment-guide.md) → [Database Documentation](database-documentation.md).
- **Calling the API directly, or integrating from Bima Anveshak?** [API Documentation](api-documentation.md).

## Documents

| Document | Audience | Covers |
|---|---|---|
| [Architecture](architecture.md) | Everyone | Three-layer model, shared contract, module catalog, design principles, ownership roadmap |
| [Developer Guide](developer-guide.md) | Engineers | File map, how to add a module, coding conventions |
| [API Documentation](api-documentation.md) | Engineers, integrators | Every `AIService` method, current and future endpoints |
| [Database Documentation](database-documentation.md) | Engineers, DBAs | Both tables, RLS, migration history |
| [Module Documentation](module-documentation.md) | Engineers, investigators | Per-module scope, inputs, response shape, distinctions |
| [Deployment Guide](deployment-guide.md) | Engineers, ops | Hosting reality, deploy process, migrations, credentials, rollback |
| [Testing Guide](testing-guide.md) | Engineers | Both test harnesses, required cases per module, gotchas |
| [User Manual](user-manual.md) | Investigators, QC, admins | How to use the feature, what statuses mean, what's not built yet |

## Integration specifications (external modules — not implemented in v1.0)

| Module | Spec |
|---|---|
| Court Case Intelligence | [court-case-intelligence-spec.md](integrations/court-case-intelligence-spec.md) |
| Litigation Intelligence | [litigation-intelligence-spec.md](integrations/litigation-intelligence-spec.md) |
| Insurance Intelligence | [insurance-intelligence-spec.md](integrations/insurance-intelligence-spec.md) |

## Version

**v1.0** — tagged `legal-intelligence-v1.0`. 9 of 12 modules implemented and production-ready (all document-based). 3 modules integration-ready but not implemented (external data sources — legal/licensing/compliance work required before implementation, see specs above). Next version (v1.1) requires explicit planning before any further implementation begins.
