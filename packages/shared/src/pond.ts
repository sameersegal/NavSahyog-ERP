// Jal Vriddhi pond + farmer + agreement-version wire shapes (spec
// §3.10, §4.3.9, §5.18). Same shapes the server returns and the
// client renders — one source of truth.

export type PondStatus = 'planned' | 'dug' | 'active' | 'inactive';
export const POND_STATUSES: readonly PondStatus[] = [
  'planned',
  'dug',
  'active',
  'inactive',
] as const;
export function isPondStatus(value: unknown): value is PondStatus {
  return typeof value === 'string'
    && (POND_STATUSES as readonly string[]).includes(value);
}

// Allowed MIMEs for an agreement scan. Scans are typically PDFs from
// a phone scanner app or photographs of a signed paper. Server uses
// this list both for presign validation and for the upload-token
// allow-list.
export const AGREEMENT_MIMES: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
];

// Agreements are docs not media — separate, smaller cap. A scanned
// 5-page PDF is < 5 MiB; 25 MiB leaves headroom for high-DPI image
// scans.
export const AGREEMENT_MAX_BYTES = 25 * 1024 * 1024;

export type Farmer = {
  id: number;
  village_id: number;
  full_name: string;
  phone: string | null;
  plot_identifier: string | null;
  created_at: number;
};

export type Pond = {
  id: number;
  farmer_id: number;
  village_id: number;
  latitude: number;
  longitude: number;
  status: PondStatus;
  notes: string | null;
  created_at: number;
};

export type PondAgreementVersion = {
  id: number;
  pond_id: number;
  version: number;
  uuid: string;
  mime: string;
  bytes: number;
  original_filename: string | null;
  notes: string | null;
  uploaded_at: number;
  uploaded_by: number;
  // Read-side URL minted by the server. Same approach as media:
  // worker-relative path that streams bytes from R2 via an
  // authenticated read-through endpoint.
  url: string;
};

// List-shape for the ponds index. Carries the farmer + the latest
// agreement version inline so a single round-trip drives the list
// view.
export type PondListItem = {
  pond: Pond;
  farmer: Farmer;
  village_name: string;
  latest_agreement: PondAgreementVersion | null;
  agreement_count: number;
};

// Detail-shape for a single pond. Carries the full agreement
// history (versions descending) so the audit trail is one query.
export type PondDetail = {
  pond: Pond;
  farmer: Farmer;
  village_name: string;
  agreements: PondAgreementVersion[];
};

// POST /api/ponds/agreements/presign body. The presign is bound to a
// village (scope check) but not yet to a pond — the same presign is
// reused both for the initial create flow and for re-upload of a
// new version.
export type AgreementPresignRequest = {
  uuid: string;
  mime: string;
  bytes: number;
  village_id: number;
};

export type AgreementPresignResponse = {
  uuid: string;
  r2_key: string;
  upload_url: string;
  upload_method: 'PUT';
  expires_at: number;
};

// Inline agreement reference passed alongside POST /api/ponds. The
// server verifies the R2 object exists at `r2_key` with `bytes` and
// transactionally creates farmer + pond + version 1.
export type AgreementCommitRef = {
  uuid: string;
  r2_key: string;
  mime: string;
  bytes: number;
  original_filename?: string | null;
  notes?: string | null;
};

export type CreatePondRequest = {
  // Either supply an existing farmer_id, or new-farmer fields. The
  // server rejects the body if neither (or both) is present.
  farmer_id?: number | null;
  farmer?: {
    village_id: number;
    full_name: string;
    phone?: string | null;
    plot_identifier?: string | null;
  };
  pond: {
    latitude: number;
    longitude: number;
    status?: PondStatus;
    notes?: string | null;
  };
  agreement: AgreementCommitRef;
};

export type AppendAgreementRequest = AgreementCommitRef;
