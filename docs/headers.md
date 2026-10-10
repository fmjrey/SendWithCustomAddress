# Thunderbird MV3 Addon — Address Field Reference

When composing an email, an MV3 Thunderbird addon can access actual email
adresses from two types of objects:

1. Compose API: `messenger.compose.getComposeDetails(tabId)` which contains the
  details of the message being composed, see
  [API doc](https://webextension-api.thunderbird.net/en/esr-mv3/compose.html#composedetails)
2. Messages API: `messenger.messages.getFull(details.relatedMessageId).headers`
  which contains the headers of the message being replied to, see
  [API doc](https://webextension-api.thunderbird.net/en/esr-mv3/messages.html#messages-headers-dictionary)
  and the [`headers` return type](#headers-return-type) section below.

The message module provides a way to work with both sources of header objects
via the `AddressFieldsSource` typedef, which is the input type for the
`normalizeHeaders` function, which returns an object of
`ParsedRecipient[]` values.

Note that the compose-side normalization is async because of address book
lookup during resolution of mailing lists and contacts into actual
email addresses. This process of resolution isn't done at present, as
it would make more sense to define aliases against mailing lists than
each individual members. Contact resolution however should be done
at some point to make sure we can match them on email address.

The following list both types of header objects and their fields.

## Core Fields present on both sides

| Object | `messenger.messages.getFull(id).headers` (`HeadersDictionary`) | `messenger.compose.getComposeDetails(tabId)` (`ComposeDetails`) |
|---------|---------------------------------------------------------------|----------------------------------------------------------------|
| From | `from` → `string[]` | `from` → `ComposeRecipient` |
| To | `to` → `string[]` | `to` → `ComposeRecipientList` |
| Cc | `cc` → `string[]` | `cc` → `ComposeRecipientList` |
| Bcc | `bcc` → `string[]` | `bcc` → `ComposeRecipientList` |

---

## Sender-side headers (message API only, no compose counterpart)

| Header | What it is |
|--------|-----------|
| `sender` | Actual submitting party (when ≠ from, e.g. assistant sending for a boss) |
| `reply-to` | Where replies should be directed |
| `return-path` | Envelope sender / bounce address (from SMTP `MAIL FROM`) |
| `resent-from` | Resent message: original sender |
| `resent-sender` | Resent message: original submitting party |
| `x-envelope-from` / `x-env-from` / `x-sender` | Non-standard envelope-sender variants (server-dependent) |

---

## Recipient-side headers (message API only, no compose counterpart)

| Header | What it is |
|--------|-----------|
| `delivered-to` | Actual mailbox the message was delivered to (added by receiving server) |
| `envelope-to` | SMTP `RCPT TO` (added by some servers, e.g. Gmail) |
| `x-original-to` | Original `To` before mailing-list expansion (added by some servers) |
| `x-envelope-to` | Variant of `envelope-to` |
| `resent-to` | Resent message: original `To` |
| `resent-cc` | Resent message: original `Cc` |
| `resent-bcc` | Resent message: original `Bcc` |

---

## Practical notes

- All values in `HeadersDictionary` are `string[]` — `parseMailboxString` works uniformly.
- `return-path` is a single address but still arrives as a one-element `string[]`.
- `delivered-to` / `envelope-to` / `x-original-to` are server-specific and not guaranteed — treat as optional enrichment.
- `resent-...` only appear on forwarded/resent messages.
- `headers.bcc` is often absent on received mail (stripped by the sending server).
- Prefer `return-path` (RFC-defined) over non-standard `x-envelope-from` / `x-sender` for the envelope sender.
- Alternative source: `getFull(...).message` gives a `MessageHeader` with pre-parsed `author` / `recipients` / `ccList` / `bccList` fields (still strings, but avoids dictionary lookup).   

## `headers` return type

In Thunderbird 147 the type `HeadersDictionary` was added and returned by
`messenger.messages.getFull(details.relatedMessageId).headers`. However this
type is just a formalization of the shape of the object that was used before.
Before 147 `headers` on the `MessagePart` returned by `getFull` was already
the same thing: a plain JavaScript object with header names as keys and
arrays of strings as values.

| Version | What happened |
|---------|--------------|
| TB 66 | `getFull` introduced, returns a `MessagePart`-like object. `headers` is `{ [string]: string[] }` (unnamed type) |
| TB 125 | Return type formally named `MessagePart` |
| TB 133 | `decodeHeaders` option + `rawHeaders` field added |
| TB 147 | `HeadersDictionary` type name introduced; `getHeaders()` function added |

Since `decodeHeaders` defaults to `true`, the API provides decoded values by
default. In TB 133 `rawHeaders` was added to access to the undecoded headers.
