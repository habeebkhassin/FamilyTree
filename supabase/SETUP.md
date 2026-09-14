# Connecting FamilyTree to a real Supabase project

FamilyTree works with no cloud at all. Everything below is optional, and
skipping it leaves a complete application that keeps a family's records on
the device they were entered on.

What this adds is an account, the same tree on a second device, sharing
with relatives, and photographs that survive a lost phone.

Twelve steps, once.

---

### 1. Create the project

At [supabase.com](https://supabase.com), create a project. Choose the
region closest to the people who will use it — every sync and every photo
crosses that distance.

Keep the database password somewhere safe. It is not used by this
application, but it is the only way back into the SQL editor's owner role.

### 2. Apply the migrations, in order

In the SQL editor, run each file in `supabase/migrations/` from top to
bottom:

```
0001_cloud_trees.sql     accounts, trees, membership, RLS
0002_change_events.sql   the change log and the push/pull functions
0003_sharing.sql         invitations and roles
0004_media.sql           photographs: the media table, the bucket, the storage policies
```

Order matters — each builds on the last, and `0004` replaces a function
`0002` defined. Run them once each; re-running is safe but pointless.

### 3. Enable Google as a sign-in provider

Authentication → Providers → Google → enable.

### 4. Create the Google OAuth client

In the [Google Cloud console](https://console.cloud.google.com), create an
OAuth 2.0 Client ID of type **Web application**.

Request **only** these scopes:

```
openid  email  profile
```

FamilyTree asks who you are and nothing else. It does not request Gmail,
Drive, Contacts or Google Photos, and it should never be configured to —
a family tree has no business holding a key to somebody's inbox.

### 5. Point Google at Supabase

Add Supabase's callback as an authorised redirect URI:

```
https://<project-ref>.supabase.co/auth/v1/callback
```

Copy the client ID and client secret into the Google provider settings in
Supabase (step 3). **The secret lives in Supabase, never in this
repository and never in a build.**

### 6. Set the redirect URLs

Authentication → URL Configuration:

- **Site URL** — where the app is served, e.g. `https://<you>.github.io/FamilyTree/`
- **Redirect URLs** — add that, plus `http://localhost:5173/FamilyTree/`
  for development.

A sign-in that returns to a URL not on this list is rejected, which is the
behaviour you want: it is what stops somebody else's site from completing
your sign-in.

### 7. Confirm the bucket is private

Storage → Buckets → `family-media`. Migration `0004` created it with
`public = false` and it must stay that way.

A public bucket would put every family photograph on the open web behind a
guessable URL, with no sign-in and no way to take it back. There is no
configuration in this application that needs it, so if it ever reads
"Public", something has changed it and the fix is to change it back.

### 8. Confirm row-level security is on

Database → Tables. Every table in `public` should show **RLS enabled**:
`profiles`, `family_trees`, `tree_members`, `people`, `parent_links`,
`unions`, `family_groups`, `family_group_members`, `change_events`,
`tree_invitations`, `media`.

The migrations enable it. This step is for catching the case where
something later turned it off.

### 9. Check the storage policies exist

Storage → Policies, on `storage.objects`. Four, all from `0004`:

```
family_media_read     select   any member of the object's tree
family_media_insert   insert   editors and owners of that tree
family_media_update   update   editors and owners of that tree
family_media_delete   delete   editors and owners of that tree
```

Each resolves the tree from the object's own path and then asks the same
membership question the rest of the schema asks. Knowing a path grants
nothing.

### 10. Give the app its two values

Copy `.env.example` to `.env.local`:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<the anon / publishable key>
```

Both are from Settings → API, both are safe in a browser bundle, and
neither is a secret — the anon key grants nothing on its own, because
everything it can reach is behind the policies in steps 8 and 9.

**Never put a service-role key here.** It bypasses row-level security
completely, and in a frontend bundle it is readable by anybody who opens
the network tab. There is no feature in FamilyTree that needs one.

`.env.local` is gitignored. Keep it that way.

### 11. Set the same two values wherever the app is built

For GitHub Pages, that is repository → Settings → Secrets and variables →
Actions. The build needs them at build time, because Vite inlines them.

A deployment with neither value set is not broken: it is the local-only
application, which is a supported way to run this.

### 12. Sign in and watch one photograph make the trip

The real test, and worth doing before anyone trusts it with their family:

1. Sign in with Google. A row appears in `public.profiles`.
2. Save a tree to the account. Rows appear in `family_trees` and
   `tree_members`.
3. Put a photo on somebody. It shows immediately — that is local.
4. Wait for a sync, then look at Storage → `family-media`. There should be
   an object under `trees/<tree-id>/media/<media-id>/original`, and a row
   in `public.media` whose `storage_path` matches.
5. Sign in on a second device. The tree arrives, and the photo follows.

If the photo shows on device one but the bucket stays empty, the upload is
queued and failing rather than lost — the photo is still safe on the
device. Check steps 7 and 9.

---

## What must never be true

- The `family-media` bucket is public.
- A service-role key appears in `.env.local`, in the repository, in CI
  variables used by the frontend build, or in any bundle.
- RLS is disabled on any table in `public`.
- The Google client requests any scope beyond `openid email profile`.
