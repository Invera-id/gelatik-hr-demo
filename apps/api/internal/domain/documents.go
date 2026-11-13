package domain

// Document review states. MISSING is derived (no current version); the others are
// stored per version. An upload is never an approval: every new version starts as
// PENDING_REVIEW, and replacing a reviewed file starts a new review.
const (
	DocMissing  = "MISSING"
	DocPending  = "PENDING_REVIEW"
	DocAccepted = "ACCEPTED"
	DocRejected = "REJECTED"
)

var docBlockerReason = map[string]string{
	DocMissing:  "Dokumen wajib belum diunggah.",
	DocPending:  "Dokumen wajib masih menunggu pemeriksaan.",
	DocRejected: "Dokumen wajib ditolak dan perlu diperbaiki.",
}

// DocumentBlockers returns, per required document type, why final validation is not
// allowed yet. current maps document type → review status of its current version.
// Only ACCEPTED satisfies a requirement (agreed minimum rule; TBC whether others suffice).
func DocumentBlockers(required []string, current map[string]string) map[string]string {
	out := map[string]string{}
	for _, code := range required {
		st, ok := current[code]
		if !ok {
			st = DocMissing
		}
		if st != DocAccepted {
			out[code] = docBlockerReason[st]
		}
	}
	return out
}
