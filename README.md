# SendWithCustomAddress - WORK IN PROGRESS

If you can create as many custom and unique email addresses as needed, on
the fly, and they all end up in the same inbox, then you probably are in
one of the following setup:

- **Catch-all**: you own a domain and configured a catch-all email address so
  that *anything*@mydomain.com arrives to the catch-all email address.
- **Plus addressing**: user+*anything*@email-provider.com arrives in your inbox
  ([RFC 5233](https://datatracker.ietf.org/doc/html/rfc5233)).
- **Subdomain addressing**: user@*anything*.domain.com, see fastmail
  [doc](https://www.fastmail.help/hc/en-us/articles/360060591053-Plus-addressing-and-subdomain-addressing).

The problem is when you reply to an email sent to such a custom email address:
the *From* field (sender) is populated with the main address not the custom one.
This add-on replaces the *From* field with the custom email address found in
the original message being replied to.

## Options

### Validating the sender address
In order to ensure a proper email address is used as sender (From field), two
patterns can be provided in the add-on options:

- **From Pattern**: a pattern the *From* field must satisfy. For example:
  - `*@mydomain.com` or the equivalent `re:[^@]+@mydomain\.com` for a
    catch-all situation,
  - `user+*@mydomain.com` or the equivalent `re:user\+[^@]+@email-provider\.com`
    for plus addressing,
  - `user@*.mydomain.com` or the equivalent `re:user@[^@.]+\.domain\.com` for
    subdomain addressing.
- **Not From Pattern**: a pattern the *From* field must NOT satisfy, which
  is useful to enforce the use of a custom address and protect the main one,
  e.g. `me@mydomain.com`.

Both are optional but recommended in order to produce a more deterministic
outcome.

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

In all cases a valid sender email address must match **From Pattern**
BUT NOT **Not From Pattern**. A visual cue warns the user a
valid sender email must be set.

On opening a compose email a valid sender email is searched as follows:
 1. Check the currently filled **From** value and if valid stop processing
 3. If the mail is a reply
    3.1 search for a valid sender among all recipients of the email being
        replied to
    3.1 else check the from field of the email being replied to, and use it
        if it's a valid sender

## Partial support from Thunderbird

A feature introduced in Thunderbird 78.0 (released July 2020) created a
checkbox in account settings named *Reply from this identity when delivery
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

Another issue is the need to create identities for each custom email.
While Thunderbird may handle 100's or even 1000's of identities, the UX
where these identities are surfaced are simple dropdowns that become
impractical beyond a few dozens.

Hence the need for some more deterministic sender selection this add-on aims
to provide by using patterns to ensure the proper custom email is used.

## Possible enhancements

1. Simplify code as it may no longer be necessary to have all these
   complicated delays in getting some values. See the following:
   - https://bugzilla.mozilla.org/show_bug.cgi?id=1675012
   - https://bugzilla.mozilla.org/show_bug.cgi?id=1785851 which seems to
     indicate that getComposeDetails() called from onClicked/onBeforeSend
     may still return stale recipient data
   - [this addon](https://github.com/gversluis/thunderbird-alias-reply-catchall)
     has a very simple code but only for the onCreated event.
1. Check minimum version requirements with respects to Manifest V3.
1. DONE Better styling on options page with light/dark theme, may be provided by
   [this project](https://github.com/micz/Thunderbird-Addon-Options-Manager).
2. Translations.
3. Allow different options per mail account. Check this
   [addon](https://github.com/gversluis/thunderbird-alias-reply-catchall)
   for inspiration.
2. Store the custom address against each recipient. If multiple recipients,
   choose the one that was used in previous emails, otherwise allow to select
   which one or create a new one. This
   [addon](https://github.com/dennisverspuij/tb-correctidentity)
   may be an inspiration.
4. If multiple custom email addresses match, allow for selecting one,
   or display some warning at least.

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
