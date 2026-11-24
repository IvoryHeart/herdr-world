## ADDED Requirements

### Requirement: Owner alerts for herdr-core askers use a Herdr connection

herdr-core has no owner notifications, so an owner alert for a question from a
herdr-core terminal or from an unplaced asker SHALL go through a Herdr
connection: the default connection when it is a Herdr connection, otherwise
the first saved Herdr connection on this computer. It SHALL NOT target a
herdr-core connection. The connection SHALL be captured when the question is
recorded and SHALL also be the ask's alert runtime; dispatch SHALL use only that
connection's current lease and SHALL NOT fall back to another connection. With
no such connection, World SHALL record the alert as not sent, and Needs you and
Town SHALL say under the question that the owner was not alerted.

#### Scenario: herdr-core default host
- **WHEN** the default host is a herdr-core connection, this computer has a saved Herdr connection, and a verified herdr-core agent asks the owner
- **THEN** the owner alert is shown through that Herdr connection

#### Scenario: No Herdr connection can alert
- **WHEN** a herdr-core agent asks and World has no Herdr connection on this computer
- **THEN** no alert is sent to any connection, the question is saved, and Needs you says World did not alert the owner
