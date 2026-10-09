# SendWithCustomAddress

> [!IMPORTANT]
> **WORK IN PROGRESS**
> This Thunderbird addon is still under development. It is functional but
> the author prefers using it for while, making sure it works properly,
> and has a minimal amount of features, before releasing it publicly
> to the addon store. See the [Roadmap](#roadmap) section.

The goal of this plugin is to support the use of custom email addresses
created on-the-fly when composing emails. On-the-fly means there is no need
to configure anything outside the act of writing an email in order to create
such custom sender address. This isn't the case when using
[identities](https://support.mozilla.org/en-US/kb/using-identities)
in Thunderbird, as they need to be setup in *Account Settings* beforehand.

Other Thunderbird features may provide some flexibility but they come short
of supporting as many email alias as needed, see section
[Partial support from Thunderbird](partial-support-from-thunderbird).
To truly support the creation of as many custom and unique email addresses,
as needed, on-the-fly, with all emails written to them ending up in in the
same inbox of your main identity/address, one of the following setup
is required:

- **Catch-all**: you own a domain and configured your mail server/service with
  a catch-all email address so that *anything*@mydomain.com arrives to the
  catch-all email address.
- **Plus addressing**: user+*anything*@email-provider.com arrives in the inbox
  of user@email-provider.com, as documented in 
  [RFC 5233](https://datatracker.ietf.org/doc/html/rfc5233).
  Gmail and many popular email providers support plus addressing.
- **Subdomain addressing**: a less common alternative to plus addressing, as
  the pattern becomes user@*anything*.domain.com, which requires some uncommon
  hosting configuration. Fastmail is a provider with such feature documented
  [here](https://www.fastmail.help/hc/en-us/articles/360060591053-Plus-addressing-and-subdomain-addressing).

The problem is when you reply to an email sent to such a custom email address:
the *From* field (sender) is populated with your main identity address and not
the custom one. This makes it easy to leak out this main address, which you
may want to keep private (spam management is easier with custom addresses).
This add-on provides some automation to ensure the *From* address is a custom
email address and not the main/catch-all address. See the [Logic](#logic)
section for more details.

## Options

### Validating the sender address
To ensure a proper email address is used as sender in the *From* field,
two patterns can be provided in this add-on options:

- **From Pattern**: a pattern the *From* address must satisfy. For example:
  - `*@mydomain.com` or the equivalent `re:[^@]+@mydomain\.com` for a
    catch-all situation,
  - `user+*@mydomain.com` or the equivalent
    `re:user\+[^@]+@email-provider\.com` for plus addressing,
  - `user@*.mydomain.com` or the equivalent `re:user@[^@.]+\.domain\.com` for
    subdomain addressing.
- **Not From Pattern**: a pattern the *From* address must NOT satisfy, which
  can be used to avoid leaking your main/catch-all address,
  e.g. `me@mydomain.com`.

Both are optional but recommended in order to produce a more deterministic
outcome when sending emails.

A *pattern* can be one of:
  * a string to be matched exactly as is in a case-insensitve way
  * a [glob](https://en.wikipedia.org/wiki/Glob_(programming)) pattern which
    may contain the following syntax elements:
    * `?` matches one and only one character
    * `*` matches zero or more characters
    * `[abc]` matches one and only one of the characters listed in brackets
    * `{abc,efg,ijk}` matches one of the alternatives given in braces and
      separated by commas
  * a [Regular Expression](https://en.wikipedia.org/wiki/Regular_expression)
    prefixed with `re:` and following the
    [JavaScript syntax](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions)
    (without the surrounding `/`).

## Logic

**Sender address validation**: the sender email address must match
**From Pattern** BUT NOT **Not From Pattern**.

**When composing a new email**: a candidate sender email is searched as follows:
 1. Check the current **From** address and if it's a valid sender address
    stop further processing.
 2. If the mail being composed is a reply
    2.1 Check the `From` field of the email being replied to, and use it
        if it's a valid sender. This covers the case of replying to one's
        own email.
    2.1 Otherwise search for a valid sender among all recipients of the email
        being replied to, the first found wins.

On pressing **Send** the sender is again verified. If invalid, a popup message
provides the reason for not being valid, and offers a way to go back or to send
anyway.

## Partial support from Thunderbird

Thunderbird supports the use of
[identities](https://support.mozilla.org/en-US/kb/using-identities) that need
to be configured in *Account Settings*.
While this may satisfy some use cases, the UX where these identities are
surfaced are simple dropdowns that become impractical beyond a few dozens.
There is also the undocumented *Customize From Address...* option in the
*From* field dropdown that lets you enter any address you want as sender.
The trouble is that not all email servers allow such flexibility, and of
course it's unlikely any reply reaches you unless you are in one of the
configurations mentioned earlier in the introduction.

Another feature introduced in Thunderbird 78.0 (released July 2020) created a
checkbox in *Account Settings* named *Reply from this identity when delivery
headers match*. The text field next to it allows for a
[glob pattern](https://en.wikipedia.org/wiki/Glob_(programming)) such as
`*@mydomain.com`. This feature is supposed to cover the catch-all and plus
addressing cases, and works by looking at the headers of the message being
replied to. If an address matching this pattern is found, it will be used as
the sender.

It was implemented under
[Bug 1518025](https://bugzilla.mozilla.org/show_bug.cgi?id=1518025),
but it does not seem to always work consistently (see for example
[Bug 1869057](https://bugzilla.mozilla.org/show_bug.cgi?id=1869057)
and [1652147](https://bugzilla.mozilla.org/show_bug.cgi?id=1652147))
and it hasn't been properly documented outside of bug reports.

Part of the issue is the order in which headers are checked, and if the first
match happens to be the catch-all/main address, it may be used instead of the
custom address.
The [Config Editor](https://support.mozilla.org/en-US/kb/config-editor) allows
for modifying the order in which headers are checked, but it may not always
be possible to find a combination that works in all cases.

Hence the need for some more deterministic sender selection this add-on aims
to provide by using patterns to ensure a proper custom email is used.

## Roadmap

The following provides some idea of what's next but constitutes no guarantee
of what is actually going to be done. Items marked with TODO are expected to
be done before a public release.

### Development tasks

1. DONE Simplify code as it may no longer be necessary to have all these
   complicated delays in getting some values. See the following:
   - https://bugzilla.mozilla.org/show_bug.cgi?id=1675012
   - https://bugzilla.mozilla.org/show_bug.cgi?id=1785851 which seems to
     indicate that getComposeDetails() called from onClicked/onBeforeSend
     may still return stale recipient data
   - [this addon](https://github.com/gversluis/thunderbird-alias-reply-catchall)
     has a very simple code but only for the onCreated event.
2. TODO Check minimum version requirements with respects to Manifest V3. For now
   the minimum version is Thunderbird 128, but this isn't tested, just infered.
3. DONE Better styling with light/dark theme, may be provided by
   [this project](https://github.com/micz/Thunderbird-Addon-Options-Manager).

### New features

1. Translations.
2. TODO Allow different options per mail account. Check this
   [addon](https://github.com/gversluis/thunderbird-alias-reply-catchall)
   for inspiration.
3. DONE For instant validation of the sender address when it changes, check
   [onIdentityChanged](https://webextension-api.thunderbird.net/en/esr-mv3/compose.html#onidentitychanged).
4. Store the custom address against each recipient. If multiple recipients,
   choose the one that was used in previous emails, otherwise allow to select
   which one or create a new one. This
   [addon](https://github.com/dennisverspuij/tb-correctidentity)
   may be an inspiration. And an extension of that could be the scanning of
   the *Sent* folder to create a first set of associations.
5. If multiple custom email addresses match, allow for selecting one.

## Credits

Some code in this project has been derived from the work of:
- [Philippe VKa](https://github.com/cyb3rmonk) and his [reply-all-auto-cc](https://github.com/cyb3rmonk/reply-all-auto-cc) add-on, later forked by:
- [ThierryBZH](https://github.com/ThierryBZH) who made the
[ReplyAsOriginalRecipientUp](https://addons.thunderbird.net/en-US/thunderbird/addon/replyasoriginalrecipientup/)
add-on which served as a basis for this one.
- [Mic](https://github.com/micz), as the files in the options directory are
  derived from his [Thunderbird-Addon-Options-Manager](https://github.com/micz/Thunderbird-Addon-Options-Manager)
  project and licensed under MPL-2.0. As part of this GPL-3.0 combined work,
  they may also be used under the terms of GPL-3.0.
- [Ask Brave](https://search.brave.com/ask) has proven to be a great pairing
  assistant to navigate the various subtleties of Thunderbird APIs, at times
  contributing some code, especially for testing, but always in a copy-paste
  mode, reviewing all suggestions (no vibe coding or agent).
