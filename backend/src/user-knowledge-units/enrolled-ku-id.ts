/** The KU an enrolment (user-kus) doc is for. Older docs have no kuId field: their doc id is the KU id. */
export const enrolledKuId = (doc: FirebaseFirestore.QueryDocumentSnapshot): string =>
  (doc.data().kuId as string | undefined) ?? doc.id;
