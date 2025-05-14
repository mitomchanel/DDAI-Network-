const figlet = require('figlet');
const chalk = require('chalk').default;


function displayBanner() {
    const banner = figlet.textSync ('Mitom Chanel', {
        font: 'Slant',
        horizontalLayout: 'default',
        verticalLayout: 'default',
        width: 80,
        whitespaceBreak: false
    })
    console.log(chalk.green(banner));
    console.log(chalk.blue('========================================='));
    console.log(chalk.magenta('Mitom Chanel'));
    console.log(chalk.magenta('https://t.me/mitomchanel'));
    console.log(chalk.blue('========================================='));
}
displayBanner();