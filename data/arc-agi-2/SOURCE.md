# Official ARC-AGI-2 puzzle data (1,120 tasks)

Source: https://github.com/arcprize/ARC-AGI-2 (official ARC Prize repo).
Identical public set distributed via:
- Kaggle "ARC Prize 2026" competition data (training + public evaluation)
- https://arcprize.org/tasks?v=2 task viewer (shows the 120 public evaluation tasks)

Contents:
- `training/`   1,000 tasks (JSON per task: {train:[{input,output}...], test:[{input,output?}...]})
- `evaluation/`   120 tasks (the public evaluation set shown on arcprize.org)
- `training-index.json`, `evaluation-index.json` — lightweight metadata index.

License: follows the upstream ARC-AGI-2 repository license (see upstream LICENSE).
Grid values are integers 0-9; test outputs may be hidden for private sets (all 120
public evaluation tasks here include outputs).
