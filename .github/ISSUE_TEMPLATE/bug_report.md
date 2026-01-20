name: Bug Report
description: Report a bug to help us improve
title: "[Bug] "
labels: ["bug"]

body:
  - type: checkboxes
    id: prerequisites
    attributes:
      label: Prerequisites
      description: Please check these boxes
      options:
        - label: I'm using the latest version of UnionCrax.Direct
          required: true
        - label: I've searched for existing issues
          required: true

  - type: textarea
    id: description
    attributes:
      label: Description
      description: Describe the bug clearly
    validations:
      required: true

  - type: textarea
    id: steps
    attributes:
      label: Steps to Reproduce
      description: Steps to reproduce the behavior
      placeholder: |
        1. Open the app
        2. Click on...
        3. See error
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: Expected Behavior
      description: What should happen?
    validations:
      required: true

  - type: textarea
    id: actual
    attributes:
      label: Actual Behavior
      description: What actually happened?
    validations:
      required: true

  - type: dropdown
    id: os
    attributes:
      label: Operating System
      options:
        - Windows 10
        - Windows 11
        - Other
    validations:
      required: true

  - type: input
    id: app_version
    attributes:
      label: App Version
      description: "e.g., 0.2.9"
    validations:
      required: true

  - type: textarea
    id: logs
    attributes:
      label: Error Messages / Logs
      description: Paste any error messages or relevant logs
      render: shell

  - type: textarea
    id: additional
    attributes:
      label: Additional Context
      description: Any other context that might help
