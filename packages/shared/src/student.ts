// Student (child) wire shape — the JSON body returned by
// /api/children[/:id]. Mirrors requirements §4.3.3 minus the
// Aadhaar-masked fields (L5).
//
// Both server and client import this so a column addition in a
// future migration fans out to both via a single compile error.

export type Gender = 'm' | 'f' | 'o';

// Extensible per §3.2.4. Widen the union here and bump the
// migration's CHECK when the set grows.
export type GraduationReason = 'pass_out' | 'other';

export type Student = {
  id: number;
  village_id: number;
  school_id: number;
  first_name: string;
  last_name: string;
  gender: Gender;
  dob: string;               // IST 'YYYY-MM-DD'
  joined_at: string;         // IST 'YYYY-MM-DD'
  graduated_at: string | null;
  graduation_reason: GraduationReason | null;
  father_name: string | null;
  father_phone: string | null;
  father_has_smartphone: 0 | 1 | null;
  mother_name: string | null;
  mother_phone: string | null;
  mother_has_smartphone: 0 | 1 | null;
  alt_contact_name: string | null;
  alt_contact_phone: string | null;
  alt_contact_relationship: string | null;
  photo_media_id: number | null;
};
