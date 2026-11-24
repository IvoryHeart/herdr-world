import argparse
import hashlib
import json
from pathlib import Path
from contract import validate_publication


def receipt_digest(report):
    return hashlib.sha256(json.dumps(report, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('reports')
    parser.add_argument('signed')
    parser.add_argument('commit')
    parser.add_argument('version')
    args = parser.parse_args()
    reports = [json.loads(path.read_text()) for path in Path(args.reports).rglob('report.json')]
    signed = json.loads(Path(args.signed).read_text())
    validate_publication(reports, signed, args.commit, args.version)
    print(receipt_digest(signed))
