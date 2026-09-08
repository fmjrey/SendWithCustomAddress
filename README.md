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

In order to ensure the proper email address is used as sender, two optional
[regular expressions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions)
can be provided in the add-on options:

- **From Regex**: a regular expression the *From* field must satisfy.
  For example:
  - `/^[^@]+@mydomain\.com$/` for a catch-all situation,
  - `/^user\+[^@]+@email-provider\.com$/` for plus addressing,
  - `/^user@[^@.]+\.domain\.com$/` for subdomain addressing.
- **Not From Regex**: a regular expression the *From* field must NOT satisfy, which
  is useful to enforce the use of a custom address and protect the main one.
  For example:
  - `/^catch-all@mydomain\.com$/` for a catch-all email,
  - `/^user@email-provider\.com$/` for plus and subdomain addressing.

Both are optional but recommended in order to prevent unintended
consequences.

TODO: check min version for this add-on

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
but it does not seem to work consistently (see for example
[Bug 1869057](https://bugzilla.mozilla.org/show_bug.cgi?id=1869057)
and [1652147](https://bugzilla.mozilla.org/show_bug.cgi?id=1652147))
and it hasn't been properly documented outside of bug reports.
Part of the issue is the order in which headers are checked, and if the first
match happens to be the catch-all/main address, it may match the glob pattern.
The [Config Editor](https://support.mozilla.org/en-US/kb/config-editor) allows
for modifying the order in which headers are checked, but this may not always
be possible to find a combination that works in all cases.

## Credits

Original work by [ThierryBZH](https://github.com/ThierryBZH) who made the
[ReplyAsOriginalRecipientUp](https://addons.thunderbird.net/en-US/thunderbird/addon/replyasoriginalrecipientup/)
add-on which served as a basis for this one.
