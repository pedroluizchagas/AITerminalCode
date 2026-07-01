-- Modelo de IA escolhido pelo celular para a sessão (equivalente ao /model
-- do terminal). NULL = padrão do OpenClaude. O daemon aplica no spawn
-- (--model) e, com o processo vivo, via control_request set_model.
alter table public.sessions add column model text;
