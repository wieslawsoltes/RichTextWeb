using System.Windows.Input;
namespace Wysiwyg.Controls;
internal sealed class EditorCommand(Action<string> execute, Func<string,bool> canExecute) : ICommand
{
    public bool CanExecute(object? parameter) => parameter is string command && canExecute(command);
    public void Execute(object? parameter) { if(parameter is string command && CanExecute(command)) execute(command); }
    public event EventHandler? CanExecuteChanged;
    public void Refresh() => CanExecuteChanged?.Invoke(this,EventArgs.Empty);
}
