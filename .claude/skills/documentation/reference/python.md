# Python docstrings

These rules add to the common rules in [`../SKILL.md`](../SKILL.md).

- Follow the Google Python Style Guide for documenting code.
- In the `Args` section, do not add the type between parentheses, nor the
  default values.
- Stick to the 88 character limit per line unless the project's formatter
  sets another one.
- Use the `Args`, `Returns`, `Yields`, `Raises`, and `Attributes` sections as
  appropriate.

```python
def find_user(user_id: str, include_deleted: bool = False) -> User:
    """Find a user by ID.

    Args:
        user_id: ID of the user to find.
        include_deleted: Whether to search deleted users too.

    Returns:
        The user that has the given ID.

    Raises:
        UserNotFoundError: User not found.
    """
```

## Parent and child class

```python
class Parent:
    """<Explanation>

    Attributes:
        parameter_parent: Some Explanation.
    """

    parameter_parent: str


class Child(Parent):
    """<Explanation>

    Also See the docstring of the parent class about inherited attributes.

    Attributes:
        parameter_child: Some Explanation.
    """

    parameter_child: str
```
