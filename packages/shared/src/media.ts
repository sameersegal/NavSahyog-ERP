// Media wire shape. Mirrors spec §4.3.7 and §5.8.
//
// L2.4 serves a flat shape with presigned GET URLs. `thumb_url`
// exists at the contract level so list views can bind to it today;
// until the derive queue lands (decisions.md D11) it points at the
// same object as `url`.

export type MediaKind = 'image' | 'video' | 'audio';

export type Media = {
  id: number;
  uuid: string;
  kind: MediaKind;
  r2_key: string;
  mime: string;
  bytes: number;
  captured_at: number;                  // UTC epoch seconds
  received_at: number;                  // UTC epoch seconds
  latitude: number | null;
  longitude: number | null;
  village_id: number;
  tag_event_id: number | null;
  created_by: number;
  deleted_at: number | null;
};

// List / get response shape — row + short-lived presigned URLs.
// Until the derive queue ships, `thumb_url` is the same object as
// `url` (decisions.md D11).
export type MediaWithUrls = Media & {
  url: string;
  thumb_url: string;
};

// POST /api/media/presign
export type MediaPresignRequest = {
  uuid: string;                         // client-generated UUIDv4
  kind: MediaKind;
  mime: string;
  bytes: number;
  village_id: number;
  captured_at: number;                  // UTC epoch seconds
};

export type MediaPresignResponse = {
  uuid: string;
  r2_key: string;
  upload_url: string;                   // where the client PUTs bytes
  upload_method: 'PUT';
  expires_at: number;                   // UTC epoch seconds
};

// POST /api/media (commit after successful PUT)
export type MediaCommitRequest = {
  uuid: string;
  kind: MediaKind;
  r2_key: string;
  mime: string;
  bytes: number;
  captured_at: number;
  latitude?: number | null;
  longitude?: number | null;
  village_id: number;
  tag_event_id?: number | null;
};
