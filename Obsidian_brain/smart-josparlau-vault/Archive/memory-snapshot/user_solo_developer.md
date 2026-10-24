---
name: Solo developer on VAPS (PS + VX)
description: User is the only developer on both PersonnelStatus and VisitX projects — capacity constraints dominate architectural choices
type: user
originSessionId: 0801e887-a939-427b-87ff-197cde1e72a7
---
User (Bratan) is the **sole developer** on both PS (PersonnelStatus, Django) and VX (VisitX) services in the VAPS project. He builds, deploys, and maintains both alone.

Implications for any advice:
- Prefer **modular monolith** over microservices for solo capacity
- Avoid solutions requiring 3+ services to maintain (e.g., shared kernel, separate identity service, dedicated DWH)
- Defer "ideal" infrastructure (Kafka, K8s, separate auth IDP) until pain is concrete
- He values simplicity and shipping over architectural purity
- Trade clean separation for pragmatic reuse where it saves him weeks of work
