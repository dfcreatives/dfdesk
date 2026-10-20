export type LoginFieldErrors = {
  name?: string;
  password?: string;
};

export function validateLoginCredentials(
  name: string,
  password: string,
): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  const trimmedName = name.trim();

  if (!trimmedName) errors.name = "Enter your login name.";
  else if (trimmedName.length < 2)
    errors.name = "Login name must contain at least 2 characters.";
  else if (trimmedName.length > 80)
    errors.name = "Login name cannot exceed 80 characters.";

  if (!password) errors.password = "Enter your password.";
  else if (password.length < 8)
    errors.password = "Password must contain at least 8 characters.";
  else if (password.length > 256)
    errors.password = "Password cannot exceed 256 characters.";

  return errors;
}
