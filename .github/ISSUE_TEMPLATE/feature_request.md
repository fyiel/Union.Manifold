name: Feature Request
description: Suggest an idea for improvement
title: "[Feature] "
labels: ["enhancement"]

body:
  - type: textarea
    id: description
    attributes:
      label: Description
      description: Describe the feature you'd like to see
    validations:
      required: true

  - type: textarea
    id: use_case
    attributes:
      label: Use Case
      description: Explain why this feature would be useful
    validations:
      required: true

  - type: textarea
    id: solution
    attributes:
      label: Proposed Solution
      description: How should this feature work?

  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives Considered
      description: Any other approaches you've considered?
